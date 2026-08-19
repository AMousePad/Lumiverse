/**
 * Direct-service-call import functions for SillyTavern migration.
 *
 * These call Lumiverse service functions directly (no HTTP), accepting a
 * userId and data read by st-reader.ts. Used by the Docker migration
 * orchestrator.
 *
 * All functions accept an optional FileSystem parameter for remote sources.
 */

import type { FileSystem } from "../file-connections/types";
import { LocalFileSystem } from "../file-connections/providers/local";

import type { MigrationLogger } from "./st-reader";
import {
  readWorldBooksFromDisk,
  readPersonasFromDisk,
  readCharacterChatFile,
  readGroupDefinitions,
  readGroupChatFileEntries,
  readGroupChatFile,
  parseDateString,
} from "./st-reader";

import { extractCardFromPng } from "../services/character-card.service";
import {
  createCharacter,
  listCharacterSourceFilenameIds,
} from "../services/characters.service";
import { uploadImage, uploadImages } from "../services/images.service";
import { createPersona, setPersonaAvatar, setPersonaImage } from "../services/personas.service";
import {
  emitWorldBookLibraryChanged,
  importWorldBookBulk,
  listSillyTavernWorldBookSourceFilenameIds,
} from "../services/world-books.service";
import { createChatRaw, bulkInsertMessages } from "../services/chats.service";
import { createCooperativeYielder, yieldToEventLoop } from "../llm/stream-utils";
import { getDb } from "../db/connection";
import type { CreateCharacterInput } from "../types/character";

// ─── Default filesystem singleton ──────────────────────────────────────────

const defaultFs = new LocalFileSystem();
const characterBatchSize = 50;
const characterReadConcurrency = 8;
const characterAvatarWriteConcurrency = 8;
const yieldEveryPersona = 4;
const yieldEveryChat = 8;
const yieldEveryGroupChat = 4;

// ─── Result types ───────────────────────────────────────────────────────────

export interface CharacterImportResult {
  imported: number;
  skipped: number;
  failed: number;
  filenameToId: Map<string, string>;
}

export interface WorldBookImportResult {
  imported: number;
  skipped: number;
  failed: number;
  totalEntries: number;
  nameToId: Map<string, string>;
}

export interface PersonaImportResult {
  imported: number;
  failed: number;
  avatarsUploaded: number;
  nameToId: Map<string, string>;
}

export interface ChatImportResult {
  imported: number;
  failed: number;
  totalMessages: number;
  skippedChars: number;
}

export interface GroupChatImportResult {
  imported: number;
  failed: number;
  skipped: number;
  totalMessages: number;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker),
  );
  return results;
}

type PreparedCharacter =
  | { kind: "existing"; filename: string; stem: string; characterId: string }
  | { kind: "failed"; filename: string }
  | {
      kind: "ready";
      filename: string;
      stem: string;
      bytes: Uint8Array;
      cardInput: CreateCharacterInput;
    };

// ─── Character import ───────────────────────────────────────────────────────

export async function importCharacters(
  userId: string,
  stDataDir: string,
  logger: MigrationLogger,
  fs: FileSystem = defaultFs,
): Promise<CharacterImportResult> {
  const charsDir = fs.join(stDataDir, "characters");
  const filenameToId = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  if (!(await fs.exists(charsDir))) return { imported, skipped, failed, filenameToId };

  const entries = await fs.readdir(charsDir);
  const pngFiles = entries.filter(
    (e) => e.isFile && fs.extname(e.name).toLowerCase() === ".png"
  );

  const total = pngFiles.length;
  // One indexed query replaces N progressively slower JSON lookups.
  const existingByFilename = listCharacterSourceFilenameIds(userId);

  for (let batchStart = 0; batchStart < pngFiles.length; batchStart += characterBatchSize) {
    const batch = pngFiles.slice(batchStart, batchStart + characterBatchSize);
    const prepared = await mapWithConcurrency(
      batch,
      characterReadConcurrency,
      async (entry): Promise<PreparedCharacter> => {
        const filename = entry.name;
        const stem = fs.basename(filename, ".png");
        const existingId = existingByFilename.get(filename);
        if (existingId) return { kind: "existing", filename, stem, characterId: existingId };

        try {
          const filePath = fs.join(charsDir, filename);
          const [buffer, fileStat] = await Promise.all([
            fs.readFile(filePath),
            fs.stat(filePath).catch(() => null),
          ]);
          const bytes = new Uint8Array(buffer);
          const cardInput = await extractCardFromPng(
            new File([bytes], filename, { type: "image/png" }),
          );
          if (cardInput.created_at == null && fileStat) {
            cardInput.created_at = fileStat.createdAt ?? fileStat.modifiedAt;
          }
          cardInput.extensions = {
            ...(cardInput.extensions ?? {}),
            _lumiverse_source_filename: filename,
          };
          return { kind: "ready", filename, stem, bytes, cardInput };
        } catch (err: any) {
          logger.warn(`Failed to import ${filename}: ${err.message}`);
          return { kind: "failed", filename };
        }
      },
    );

    const created: Array<{
      filename: string;
      bytes: Uint8Array;
      characterId: string;
    }> = [];

    // Keep commits bounded, but collapse the per-card autocommit overhead.
    getDb().transaction(() => {
      for (const item of prepared) {
        if (item.kind === "existing") {
          filenameToId.set(item.stem, item.characterId);
          skipped++;
          continue;
        }
        if (item.kind === "failed") {
          failed++;
          continue;
        }
        try {
          const character = createCharacter(userId, item.cardInput, { emitEvent: false });
          filenameToId.set(item.stem, character.id);
          existingByFilename.set(item.filename, character.id);
          created.push({
            filename: item.filename,
            bytes: item.bytes,
            characterId: character.id,
          });
          imported++;
        } catch (err: any) {
          logger.warn(`Failed to import ${item.filename}: ${err.message}`);
          failed++;
        }
      }
    })();

    if (created.length > 0) {
      try {
        // Store originals in parallel and let thumbnails generate lazily on
        // first use. Starting two Sharp jobs for every card would swamp large
        // migrations long after their database phase completed.
        const avatarResults = await uploadImages(
          userId,
          created.map((item) => ({
            data: item.bytes,
            filename: item.filename,
            mime_type: "image/png",
            owner_character_id: item.characterId,
          })),
          {
            concurrency: characterAvatarWriteConcurrency,
            deferProcessing: false,
          },
        );

        const attachAvatar = getDb().query(
          `UPDATE characters
           SET image_id = ?, avatar_path = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        );
        const now = Math.floor(Date.now() / 1000);
        getDb().transaction(() => {
          for (let i = 0; i < avatarResults.length; i++) {
            const image = avatarResults[i]?.image;
            if (!image) continue;
            attachAvatar.run(image.id, image.filename, now, created[i].characterId, userId);
          }
        })();
      } catch (err: any) {
        logger.warn(`Avatar batch failed; characters were still imported: ${err.message}`);
      }
    }

    for (let i = 0; i < batch.length; i++) {
      logger.progress("Importing characters", batchStart + i + 1, total);
    }
    await yieldToEventLoop();
  }

  return { imported, skipped, failed, filenameToId };
}

// ─── World book import ──────────────────────────────────────────────────────

export async function importWorldBooks(
  userId: string,
  stDataDir: string,
  logger: MigrationLogger,
  fs: FileSystem = defaultFs,
): Promise<WorldBookImportResult> {
  const nameToId = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let totalEntries = 0;

  const worldBooks = await readWorldBooksFromDisk(stDataDir, logger, fs);
  const total = worldBooks.length;
  const existingByFilename = listSillyTavernWorldBookSourceFilenameIds(userId);

  try {
    for (let i = 0; i < worldBooks.length; i++) {
      const wb = worldBooks[i];
      logger.progress("Importing world books", i + 1, total);

      const existingId = existingByFilename.get(wb.filename);
      if (existingId) {
        nameToId.set(wb.name, existingId);
        skipped++;
        await yieldToEventLoop();
        continue;
      }

      try {
        const result = await importWorldBookBulk(userId, wb, {
          emitEvent: false,
          metadata: {
            source: "sillytavern_migration",
            _lumiverse_source_filename: wb.filename,
          },
        });
        imported++;
        totalEntries += result.entryCount;
        nameToId.set(wb.name, result.worldBook.id);
        existingByFilename.set(wb.filename, result.worldBook.id);
      } catch (err: any) {
        logger.warn(`Failed to import world book "${wb.name}": ${err.message}`);
        failed++;
      }

      await yieldToEventLoop();
    }
  } finally {
    if (imported > 0) {
      emitWorldBookLibraryChanged(userId, {
        reason: "sillytavern_migration",
        imported,
      });
    }
  }

  return { imported, skipped, failed, totalEntries, nameToId };
}

// ─── Persona import ─────────────────────────────────────────────────────────

export async function importPersonas(
  userId: string,
  stDataDir: string,
  worldBookNameToId: Map<string, string>,
  logger: MigrationLogger,
  fs: FileSystem = defaultFs,
): Promise<PersonaImportResult> {
  const nameToId = new Map<string, string>();
  let imported = 0;
  let failed = 0;
  let avatarsUploaded = 0;

  const personaPayloads = await readPersonasFromDisk(stDataDir, fs);
  const total = personaPayloads.length;
  const maybeYield = createCooperativeYielder(yieldEveryPersona);

  for (let i = 0; i < personaPayloads.length; i++) {
    const p = personaPayloads[i];
    logger.progress("Importing personas", i + 1, total);

    try {
      const attachedWbId = p.lorebookName ? worldBookNameToId.get(p.lorebookName) : undefined;

      const persona = createPersona(userId, {
        name: p.name,
        description: p.description || undefined,
        title: p.title || undefined,
        attached_world_book_id: attachedWbId,
      });

      nameToId.set(p.name, persona.id);
      imported++;

      // Try avatar upload
      const avatarDir = fs.join(stDataDir, "User Avatars");
      const avatarPath = fs.join(avatarDir, p.avatarKey);

      if (await fs.exists(avatarPath)) {
        try {
          const avatarBuffer = await fs.readFile(avatarPath);
          const avatarBytes = new Uint8Array(avatarBuffer);
          const mimeType = p.avatarKey.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
          const file = new File([avatarBytes], p.avatarKey, { type: mimeType });
          const image = await uploadImage(userId, file);
          setPersonaImage(userId, persona.id, image.id);
          setPersonaAvatar(userId, persona.id, image.filename);
          avatarsUploaded++;
        } catch {
          // Avatar upload failed, not critical
        }
      }
    } catch (err: any) {
      logger.warn(`Failed to import persona "${p.name}": ${err.message}`);
      failed++;
    }

    await maybeYield();
  }

  return { imported, failed, avatarsUploaded, nameToId };
}

// ─── Chat import ────────────────────────────────────────────────────────────

export async function importChats(
  userId: string,
  stDataDir: string,
  filenameToId: Map<string, string>,
  personaNameToId: Map<string, string>,
  logger: MigrationLogger,
  fs: FileSystem = defaultFs,
): Promise<ChatImportResult> {
  const chatsDir = fs.join(stDataDir, "chats");
  let imported = 0;
  let failed = 0;
  let totalMessages = 0;
  let skippedChars = 0;

  if (!(await fs.exists(chatsDir))) return { imported, failed, totalMessages, skippedChars };

  const entries = await fs.readdir(chatsDir);
  const charDirs = entries.filter((e) => e.isDirectory);

  // Count total chats for progress
  let totalChats = 0;
  for (const dir of charDirs) {
    const chatEntries = await fs.readdir(fs.join(chatsDir, dir.name));
    totalChats += chatEntries.filter(
      (e) => e.isFile && fs.extname(e.name).toLowerCase() === ".jsonl"
    ).length;
  }

  let processedChats = 0;
  const maybeYield = createCooperativeYielder(yieldEveryChat);

  for (const charDirEntry of charDirs) {
    const charDirName = charDirEntry.name;
    const characterId = filenameToId.get(charDirName);

    if (!characterId) {
      const chatEntries = await fs.readdir(fs.join(chatsDir, charDirName));
      const chatCount = chatEntries.filter(
        (e) => e.isFile && fs.extname(e.name).toLowerCase() === ".jsonl"
      ).length;
      skippedChars++;
      processedChats += chatCount;
      logger.warn(`No character found for "${charDirName}", skipping ${chatCount} chat(s)`);
      logger.progress("Importing chats", processedChats, totalChats);
      await maybeYield();
      continue;
    }

    const chatEntries = await fs.readdir(fs.join(chatsDir, charDirName));
    const jsonlFiles = chatEntries.filter(
      (e) => e.isFile && fs.extname(e.name).toLowerCase() === ".jsonl"
    );

    for (const chatFile of jsonlFiles) {
      try {
        const chatData = await readCharacterChatFile({
          stDataDir,
          charDirName,
          chatFileName: chatFile.name,
          personaNameToId,
          filenameToId,
          fs,
        });

        if (!chatData) {
          logger.warn(`Could not read ${charDirName}/${chatFile.name}, skipping`);
          continue;
        }

        const chat = createChatRaw(userId, {
          character_id: characterId,
          name: chatData.name,
          metadata: chatData.metadata,
          created_at: chatData.created_at,
        });

        const msgCount = bulkInsertMessages(chat.id, chatData.messages, userId);
        imported++;
        totalMessages += msgCount;
      } catch (err: any) {
        logger.warn(`Failed to import chat "${charDirName}/${chatFile.name}": ${err.message}`);
        failed++;
      } finally {
        processedChats++;
        logger.progress("Importing chats", processedChats, totalChats);
        await maybeYield();
      }
    }
  }

  return { imported, failed, totalMessages, skippedChars };
}

// ─── Group chat import ──────────────────────────────────────────────────────

export async function importGroupChats(
  userId: string,
  stDataDir: string,
  filenameToId: Map<string, string>,
  personaNameToId: Map<string, string>,
  logger: MigrationLogger,
  fs: FileSystem = defaultFs,
): Promise<GroupChatImportResult> {
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  let totalMessages = 0;

  const groupDefs = await readGroupDefinitions(stDataDir, fs);
  if (groupDefs.length === 0) return { imported, failed, skipped, totalMessages };

  const groupChatFiles = await readGroupChatFileEntries(stDataDir, fs);
  const referencedChatIds = new Set<string>();
  for (const group of groupDefs) {
    for (const chatId of group.chatIds) {
      referencedChatIds.add(
        chatId.toLowerCase().endsWith(".jsonl") ? fs.basename(chatId, ".jsonl") : chatId
      );
    }
  }

  const unreferencedGroupChatFiles = groupChatFiles.filter((entry) => !referencedChatIds.has(entry.id));
  if (unreferencedGroupChatFiles.length > 0) {
    failed += unreferencedGroupChatFiles.length;
    logger.warn(
      `${unreferencedGroupChatFiles.length} group chat file(s) were not listed in any groups/*.json chats array and could not be matched to a group`
    );
  }

  // Count total chat files for progress
  let totalChatsToProcess = 0;
  for (const gd of groupDefs) totalChatsToProcess += gd.chatIds.length;

  let processedChats = 0;
  const maybeYield = createCooperativeYielder(yieldEveryGroupChat);

  for (const group of groupDefs) {
    // Resolve member character IDs
    const memberCharIds: string[] = [];
    for (const memberFile of group.members) {
      const stem = fs.basename(memberFile, ".png");
      const charId = filenameToId.get(stem);
      if (charId) memberCharIds.push(charId);
    }

    if (memberCharIds.length === 0) {
      skipped++;
      processedChats += group.chatIds.length;
      logger.warn(`No members found for group "${group.name}", skipping`);
      logger.progress("Importing group chats", processedChats, totalChatsToProcess);
      await maybeYield();
      continue;
    }

    for (const chatId of group.chatIds) {
      const chatData = await readGroupChatFile(stDataDir, chatId, personaNameToId, filenameToId, fs);

      if (!chatData) {
        logger.warn(`Could not read group chat "${group.name}/${chatId}", skipping`);
        failed++;
        processedChats++;
        logger.progress("Importing group chats", processedChats, totalChatsToProcess);
        await maybeYield();
        continue;
      }

      try {
        let chatCreatedAt = chatData.createdAt;
        if (!chatCreatedAt && group.createDate) {
          const ts = parseDateString(group.createDate);
          if (ts) chatCreatedAt = ts;
        }

        const chat = createChatRaw(userId, {
          character_id: memberCharIds[0],
          name: group.name,
          metadata: { group: true, character_ids: memberCharIds },
          created_at: chatCreatedAt,
        });

        const msgCount = bulkInsertMessages(chat.id, chatData.messages, userId);
        imported++;
        totalMessages += msgCount;
      } catch (err: any) {
        logger.warn(`Failed to import group chat "${group.name}/${chatId}": ${err.message}`);
        failed++;
      }

      processedChats++;
      logger.progress("Importing group chats", processedChats, totalChatsToProcess);
      await maybeYield();
    }
  }

  return { imported, failed, skipped, totalMessages };
}

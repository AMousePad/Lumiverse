import { useScaledSortable } from '@/lib/dndUiScale'
import { sortableFolderId } from '@/hooks/useSortableFolders'
import FolderSection, { type FolderSectionProps } from './FolderSection'
import styles from './SortableFolderSection.module.css'

/** The same folder presentation, with the header acting as its sortable handle. */
export default function SortableFolderSection({
  id, hidden, disabled, reorderDisabled, receiving, ...section
}: FolderSectionProps & {
  id: string
  hidden?: boolean
  disabled?: boolean
  reorderDisabled?: boolean
  receiving?: boolean
}) {
  const { setNodeRef, style, isDragging, attributes, listeners } = useScaledSortable({
    id: sortableFolderId(id),
    disabled: { draggable: disabled || reorderDisabled, droppable: disabled || hidden },
  })
  return (
    <div ref={setNodeRef} style={style} hidden={hidden}
      data-drop-target={receiving || undefined} data-sortable-folder={id}
      className={`${styles.folder} ${isDragging ? styles.dragging : ''}`}>
      <FolderSection {...section} keepMounted
        headerDragProps={{ ...attributes, ...listeners, 'aria-disabled': undefined,
          style: { cursor: disabled || reorderDisabled ? undefined : 'grab', touchAction: 'none' } }} />
    </div>
  )
}

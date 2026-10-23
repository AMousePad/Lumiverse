#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface LumiverseActivityActions : NSObject
+ (void)stopGeneration:(NSString *)generationId completion:(void (^)(NSError * _Nullable error))completion;
+ (void)hideGeneration:(NSString *)generationId completion:(void (^)(void))completion;
@end
NS_ASSUME_NONNULL_END

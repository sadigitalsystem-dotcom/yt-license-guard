#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>

// رابط السيرفر السحابي المباشر على Render
static NSString * const kServerEndpoint = @"https://yt-license-guard.onrender.com/api/activate";
static NSString * const kVerifyEndpoint = @"https://yt-license-guard.onrender.com/api/verify";
static NSString * const kPrefsKey = @"YTIOS_SERIAL_KEY";

@interface YouTubeLicenseGuard : NSObject
+ (instancetype)shared;
- (void)verifySubscriptionOnStartup;
@end

@implementation YouTubeLicenseGuard {
    UIWindow *lockWindow;
    UIActivityIndicatorView *spinner;
    UILabel *statusLabel;
    UITextField *keyInputField;
    UIButton *activateBtn;
    UIButton *copyDevIdBtn;
}

+ (instancetype)shared {
    static YouTubeLicenseGuard *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[YouTubeLicenseGuard alloc] init];
    });
    return instance;
}

- (NSString *)getDeviceID {
    return [[[UIDevice currentDevice] identifierForVendor] UUIDString] ?: @"IOS-UNKNOWN-DEVICE";
}

- (NSString *)getDeviceTypeString {
    if ([UIDevice currentDevice].userInterfaceIdiom == UIUserInterfaceIdiomPad) {
        return @"📱 آيباد (iPad)";
    }
    return @"📱 آيفون (iPhone)";
}

// عرض شاشة القفل العربية الأنيقة فوق كافة واجهات التطبيق
- (void)presentLockOverlayWithMessage:(NSString *)errorMsg {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self->lockWindow) {
            UIWindowScene *scene = nil;
            for (UIScene *s in [UIApplication sharedApplication].connectedScenes) {
                if ([s isKindOfClass:[UIWindowScene class]] && s.activationState == UISceneActivationStateForegroundActive) {
                    scene = (UIWindowScene *)s;
                    break;
                }
            }
            if (scene) {
                self->lockWindow = [[UIWindow alloc] initWithWindowScene:scene];
            } else {
                self->lockWindow = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
            }
            self->lockWindow.windowLevel = UIWindowLevelAlert + 1000;
            self->lockWindow.backgroundColor = [UIColor clearColor];

            UIViewController *rootVC = [[UIViewController alloc] init];
            rootVC.view.backgroundColor = [UIColor clearColor];

            // خلفية ضبابية داكنة (Dark Blur Effect)
            UIBlurEffect *blurEffect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemUltraThinMaterialDark];
            UIVisualEffectView *blurView = [[UIVisualEffectView alloc] initWithEffect:blurEffect];
            blurView.frame = rootVC.view.bounds;
            blurView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
            [rootVC.view addSubview:blurView];

            // بطاقة الحوار الوسطى
            CGFloat cardW = 320;
            CGFloat cardH = 390;
            UIView *card = [[UIView alloc] initWithFrame:CGRectMake(0, 0, cardW, cardH)];
            card.center = rootVC.view.center;
            card.backgroundColor = [UIColor colorWithRed:0.09 green:0.09 blue:0.11 alpha:0.96];
            card.layer.cornerRadius = 24;
            card.layer.borderWidth = 1.0;
            card.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.12].CGColor;
            card.clipsToBounds = YES;
            [rootVC.view addSubview:card];

            // أيقونة القفل
            UIImageView *iconView = [[UIImageView alloc] initWithFrame:CGRectMake((cardW - 54) / 2, 22, 54, 54)];
            if (@available(iOS 13.0, *)) {
                iconView.image = [UIImage systemImageNamed:@"lock.shield.fill"];
            }
            iconView.tintColor = [UIColor colorWithRed:1.0 green:0.2 blue:0.2 alpha:1.0];
            iconView.contentMode = UIViewContentModeScaleAspectFit;
            [card addSubview:iconView];

            // العنوان الرئيسي للعلامة التجارية
            UILabel *titleLabel = [[UILabel alloc] initWithFrame:CGRectMake(16, 84, cardW - 32, 26)];
            titleLabel.text = @"YouTube PLUS+ - النظام الرقمي";
            titleLabel.textColor = [UIColor whiteColor];
            titleLabel.font = [UIFont boldSystemFontOfSize:17];
            titleLabel.textAlignment = NSTextAlignmentCenter;
            [card addSubview:titleLabel];

            // وصف الحالة ورسائل الخطأ
            self->statusLabel = [[UILabel alloc] initWithFrame:CGRectMake(16, 114, cardW - 32, 42)];
            self->statusLabel.text = errorMsg ?: @"أدخل مفتاح التنشيط الخاص بك لتفعيل باقة بلس:";
            self->statusLabel.textColor = errorMsg ? [UIColor colorWithRed:1.0 green:0.4 blue:0.4 alpha:1.0] : [UIColor colorWithWhite:0.8 alpha:1.0];
            self->statusLabel.font = [UIFont systemFontOfSize:13];
            self->statusLabel.textAlignment = NSTextAlignmentCenter;
            self->statusLabel.numberOfLines = 2;
            [card addSubview:self->statusLabel];

            // حقل إدخال كود التفعيل
            self->keyInputField = [[UITextField alloc] initWithFrame:CGRectMake(24, 166, cardW - 48, 48)];
            self->keyInputField.placeholder = @"PLUS-XXXX-XXXX-XXXX";
            self->keyInputField.backgroundColor = [UIColor colorWithWhite:0.16 alpha:1.0];
            self->keyInputField.textColor = [UIColor whiteColor];
            self->keyInputField.textAlignment = NSTextAlignmentCenter;
            self->keyInputField.layer.cornerRadius = 14;
            self->keyInputField.autocapitalizationType = UITextAutocapitalizationTypeAllCharacters;
            self->keyInputField.autocorrectionType = UITextAutocorrectionTypeNo;
            self->keyInputField.font = [UIFont monospacedSystemFontOfSize:14 weight:UIFontWeightBold];
            [card addSubview:self->keyInputField];

            // زر التفعيل
            self->activateBtn = [UIButton buttonWithType:UIButtonTypeCustom];
            self->activateBtn.frame = CGRectMake(24, 226, cardW - 48, 48);
            self->activateBtn.backgroundColor = [UIColor colorWithRed:0.9 green:0.1 blue:0.1 alpha:1.0];
            [self->activateBtn setTitle:@"تفعيل الاشتراك الآن" forState:UIControlStateNormal];
            self->activateBtn.titleLabel.font = [UIFont boldSystemFontOfSize:15];
            self->activateBtn.layer.cornerRadius = 14;
            [self->activateBtn addTarget:self action:@selector(handleActivationButton) forControlEvents:UIControlEventTouchUpInside];
            [card addSubview:self->activateBtn];

            // زر نسخ معرف الجهاز (للعميل في حال واجه أي مشكلة أو دعم فني)
            NSString *devId = [self getDeviceID];
            NSString *shortId = devId.length > 8 ? [devId substringToIndex:8] : devId;
            self->copyDevIdBtn = [UIButton buttonWithType:UIButtonTypeSystem];
            self->copyDevIdBtn.frame = CGRectMake(20, 286, cardW - 40, 28);
            [self->copyDevIdBtn setTitle:[NSString stringWithFormat:@"معرف جهازك: %@... (انقر للنسخ)", shortId] forState:UIControlStateNormal];
            self->copyDevIdBtn.titleLabel.font = [UIFont systemFontOfSize:11];
            [self->copyDevIdBtn setTitleColor:[UIColor colorWithWhite:0.6 alpha:1.0] forState:UIControlStateNormal];
            [self->copyDevIdBtn addTarget:self action:@selector(handleCopyDeviceId) forControlEvents:UIControlEventTouchUpInside];
            [card addSubview:self->copyDevIdBtn];

            // مؤشر التحميل (Spinner)
            self->spinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium];
            self->spinner.center = CGPointMake(cardW / 2, 340);
            self->spinner.color = [UIColor whiteColor];
            self->spinner.hidesWhenStopped = YES;
            [card addSubview:self->spinner];

            self->lockWindow.rootViewController = rootVC;
            [self->lockWindow makeKeyAndVisible];
        } else {
            self->statusLabel.text = errorMsg ?: @"كود التفعيل مطلوب للاستمرار";
            self->statusLabel.textColor = [UIColor colorWithRed:1.0 green:0.4 blue:0.4 alpha:1.0];
        }
    });
}

- (void)handleCopyDeviceId {
    [UIPasteboard generalPasteboard].string = [self getDeviceID];
    if (self->copyDevIdBtn) {
        [self->copyDevIdBtn setTitle:@"✓ تم نسخ معرف الجهاز بنجاح" forState:UIControlStateNormal];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            NSString *devId = [self getDeviceID];
            NSString *shortId = devId.length > 8 ? [devId substringToIndex:8] : devId;
            [self->copyDevIdBtn setTitle:[NSString stringWithFormat:@"معرف جهازك: %@... (انقر للنسخ)", shortId] forState:UIControlStateNormal];
        });
    }
}

- (void)handleActivationButton {
    NSString *inputKey = [self->keyInputField.text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (!inputKey || inputKey.length < 5) {
        self->statusLabel.text = @"يرجى كتابة كود تفعيل صحيح";
        self->statusLabel.textColor = [UIColor colorWithRed:1.0 green:0.4 blue:0.4 alpha:1.0];
        return;
    }

    [self->spinner startAnimating];
    [self->activateBtn setEnabled:NO];

    [self sendActivateRequestWithKey:inputKey isManual:YES];
}

- (void)sendActivateRequestWithKey:(NSString *)serialKey isManual:(BOOL)isManual {
    NSString *deviceId = [self getDeviceID];
    NSString *deviceType = [self getDeviceTypeString];
    NSURL *url = [NSURL URLWithString:kServerEndpoint];

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    [request setHTTPMethod:@"POST"];
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    request.timeoutInterval = 10.0;

    NSDictionary *payload = @{
        @"serial_key": serialKey ?: @"",
        @"device_id": deviceId ?: @"",
        @"device_type": deviceType ?: @"📱 آيفون (iOS)"
    };

    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];

    [[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self->spinner stopAnimating];
            [self->activateBtn setEnabled:YES];

            if (err) {
                if (isManual) {
                    self->statusLabel.text = @"تعذر الاتصال بالسيرفر! تحقق من اتصال الإنترنت";
                    self->statusLabel.textColor = [UIColor colorWithRed:1.0 green:0.4 blue:0.4 alpha:1.0];
                }
                return;
            }

            NSHTTPURLResponse *httpRes = (NSHTTPURLResponse *)res;
            NSDictionary *json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;

            if (httpRes.statusCode == 200 && [json[@"status"] isEqualToString:@"success"]) {
                // حفظ الكود الصالح محلياً في جهاز الآيفون
                [[NSUserDefaults standardUserDefaults] setObject:serialKey forKey:kPrefsKey];
                [[NSUserDefaults standardUserDefaults] synchronize];

                [self startHeartbeatWithKey:serialKey];

                // إخفاء شاشة القفل بحركة انسيابية
                [UIView animateWithDuration:0.35 animations:^{
                    self->lockWindow.alpha = 0.0;
                } completion:^(BOOL finished) {
                    [self->lockWindow setHidden:YES];
                    self->lockWindow = nil;
                }];
            } else {
                NSString *msg = json[@"message"] ?: @"الكود غير صالح أو انتهت صلاحيته";
                [self presentLockOverlayWithMessage:msg];
            }
        });
    }] resume];
}

- (void)startHeartbeatWithKey:(NSString *)serialKey {
    static dispatch_source_t heartbeatTimer = nil;
    static dispatch_once_t timerToken;
    dispatch_once(&timerToken, ^{
        dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_BACKGROUND, 0);
        heartbeatTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
        dispatch_source_set_timer(heartbeatTimer, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), 30 * NSEC_PER_SEC, 2 * NSEC_PER_SEC);
        dispatch_source_set_event_handler(heartbeatTimer, ^{
            NSString *currentKey = [[NSUserDefaults standardUserDefaults] stringForKey:kPrefsKey];
            if (!currentKey || currentKey.length == 0) return;

            NSString *deviceId = [[YouTubeLicenseGuard shared] getDeviceID];
            NSURL *url = [NSURL URLWithString:kVerifyEndpoint];
            NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
            [req setHTTPMethod:@"POST"];
            [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
            req.timeoutInterval = 8.0;
            NSDictionary *body = @{@"serial_key": currentKey, @"device_id": deviceId};
            req.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];

            [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
                if (err) return;
                NSHTTPURLResponse *httpRes = (NSHTTPURLResponse *)res;
                if (httpRes.statusCode == 403 || httpRes.statusCode == 404) {
                    // الكود تم حظره أو حذفه أو انتهاء صلاحيته من لوحة التحكم
                    [[NSUserDefaults standardUserDefaults] removeObjectForKey:kPrefsKey];
                    [[NSUserDefaults standardUserDefaults] synchronize];
                    dispatch_async(dispatch_get_main_queue(), ^{
                        [[YouTubeLicenseGuard shared] presentLockOverlayWithMessage:@"تم إيقاف الاشتراك أو انتهت صلاحيته من لوحة التحكم"];
                    });
                }
            }] resume];
        });
        dispatch_resume(heartbeatTimer);
    });
}

- (void)verifySubscriptionOnStartup {
    NSString *savedKey = [[NSUserDefaults standardUserDefaults] stringForKey:kPrefsKey];
    if (!savedKey || savedKey.length == 0) {
        [self presentLockOverlayWithMessage:nil];
    } else {
        // التحقق الصامت والسريع عند بدء التشغيل
        NSString *deviceId = [self getDeviceID];
        NSURL *url = [NSURL URLWithString:kVerifyEndpoint];
        NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
        [req setHTTPMethod:@"POST"];
        [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        req.timeoutInterval = 6.0;
        NSDictionary *body = @{@"serial_key": savedKey, @"device_id": deviceId};
        req.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];

        [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
            if (err) {
                // في حالة انقطاع الإنترنت المؤقت، نسمح له بالاستمرار طالما الكود مخزن مسبقاً
                [self startHeartbeatWithKey:savedKey];
                return;
            }
            NSHTTPURLResponse *httpRes = (NSHTTPURLResponse *)res;
            if (httpRes.statusCode == 200) {
                [self startHeartbeatWithKey:savedKey];
            } else {
                NSDictionary *json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
                NSString *msg = json[@"message"] ?: @"انتهت صلاحية الاشتراك";
                [[NSUserDefaults standardUserDefaults] removeObjectForKey:kPrefsKey];
                [[NSUserDefaults standardUserDefaults] synchronize];
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self presentLockOverlayWithMessage:msg];
                });
            }
        }] resume];
    }
}
@end

// بدء تفعيل الحماية تلقائياً بمجرد اكتمال إقلاع التطبيق
__attribute__((constructor))
static void initLicenseGuard(void) {
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil
                                                       queue:[NSOperationQueue mainQueue]
                                                  usingBlock:^(NSNotification *note) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [[YouTubeLicenseGuard shared] verifySubscriptionOnStartup];
        });
    }];
}

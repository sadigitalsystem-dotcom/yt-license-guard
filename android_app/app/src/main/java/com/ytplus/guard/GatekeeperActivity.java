package com.ytplus.guard;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * GatekeeperActivity: شاشة حماية وتفعيل متكاملة ومستقلة 100%
 * مدمجة داخل تطبيق يوتيوب بريميوم نفسه كنشاط بداية رئيسي (Main Launcher).
 * لا تعتمد على أي ملفات XML خارجية لضمان العمل التام داخل أي APK دون أي تعارض في الموارد.
 */
public class GatekeeperActivity extends Activity {

    private static final String SERVER_URL = "https://yt-license-guard.onrender.com";
    private static final String PREFS_NAME = "yt_plus_embedded_prefs";
    private static final String PREF_KEY_LICENSE = "license_key";
    private static final String PREF_KEY_DEVICE_ID = "device_id";

    // النشاط الرئيسي لتطبيق يوتيوب بريميوم الحقيقي داخل نفس الحزمة
    private static final String TARGET_ACTIVITY_1 = "com.google.android.apps.youtube.app.watchwhile.WatchWhileActivity";
    private static final String TARGET_ACTIVITY_2 = "com.google.android.apps.youtube.app.WatchWhileActivity";
    private static final String TARGET_ACTIVITY_3 = "com.google.android.youtube.app.honeycomb.Shell$HomeActivity";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private String deviceId;
    private SharedPreferences prefs;

    private LinearLayout containerChecking;
    private LinearLayout containerForm;
    private EditText etLicenseKey;
    private TextView tvStatusMessage;
    private Button btnActivate;
    private ProgressBar progressBarAction;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        resolveDeviceId();

        // إنشاء واجهة المستخدم برمجياً بشكل احترافي
        View mainView = buildUserInterface();
        setContentView(mainView);

        // فحص وجود ترخيص مسجل مسبقاً
        String savedLicense = prefs.getString(PREF_KEY_LICENSE, null);
        if (savedLicense != null && !savedLicense.trim().isEmpty()) {
            verifySavedLicense(savedLicense.trim());
        } else {
            showFormView();
        }
    }

    private void resolveDeviceId() {
        try {
            deviceId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception ignored) {}

        if (deviceId == null || deviceId.trim().isEmpty() || "9774d56d682e549c".equals(deviceId)) {
            deviceId = prefs.getString(PREF_KEY_DEVICE_ID, null);
            if (deviceId == null) {
                deviceId = "AND-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
                prefs.edit().putString(PREF_KEY_DEVICE_ID, deviceId).apply();
            }
        }
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
        );
    }

    private View buildUserInterface() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(Color.parseColor("#0F0F0F"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(20), dp(30), dp(20), dp(30));

        // البطاقة الرئيسية
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(24), dp(28), dp(24), dp(28));

        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.parseColor("#181818"));
        cardBg.setCornerRadius(dp(20));
        cardBg.setStroke(dp(1), Color.parseColor("#282828"));
        card.setBackground(cardBg);

        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        cardParams.maxWidth = dp(420);
        card.setLayoutParams(cardParams);

        // شارة الأيقونة الحمراء
        TextView tvIconBadge = new TextView(this);
        tvIconBadge.setText("▶+");
        tvIconBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        tvIconBadge.setTextColor(Color.WHITE);
        tvIconBadge.setGravity(Gravity.CENTER);
        tvIconBadge.setTypeface(Typeface.DEFAULT_BOLD);

        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(Color.parseColor("#FF0000"));
        badgeBg.setCornerRadius(dp(16));
        tvIconBadge.setBackground(badgeBg);

        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(dp(64), dp(64));
        badgeParams.gravity = Gravity.CENTER_HORIZONTAL;
        card.addView(tvIconBadge, badgeParams);

        // عنوان التطبيق الرئيسي
        TextView tvTitle = new TextView(this);
        tvTitle.setText("YouTube PLUS+");
        tvTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        tvTitle.setTextColor(Color.WHITE);
        tvTitle.setTypeface(Typeface.DEFAULT_BOLD);
        tvTitle.setGravity(Gravity.CENTER);

        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleParams.topMargin = dp(14);
        card.addView(tvTitle, titleParams);

        // العنوان الفرعي بالعربية
        TextView tvSubTitle = new TextView(this);
        tvSubTitle.setText("(يوتيوب بلس+) النسخة الخاصة");
        tvSubTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tvSubTitle.setTextColor(Color.parseColor("#FF334B"));
        tvSubTitle.setGravity(Gravity.CENTER);
        card.addView(tvSubTitle);

        // خط فاصل
        View divider = new View(this);
        divider.setBackgroundColor(Color.parseColor("#22FFFFFF"));
        LinearLayout.LayoutParams divParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(1)
        );
        divParams.topMargin = dp(20);
        divParams.bottomMargin = dp(20);
        card.addView(divider, divParams);

        // حاوية الفحص اللحظي (Checking State)
        containerChecking = new LinearLayout(this);
        containerChecking.setOrientation(LinearLayout.VERTICAL);
        containerChecking.setGravity(Gravity.CENTER);
        containerChecking.setVisibility(View.GONE);

        ProgressBar pbChecking = new ProgressBar(this);
        containerChecking.addView(pbChecking);

        TextView tvCheckingMsg = new TextView(this);
        tvCheckingMsg.setText("جاري التحقق من صلاحية الاشتراك...");
        tvCheckingMsg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tvCheckingMsg.setTextColor(Color.parseColor("#AAAAAA"));
        tvCheckingMsg.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams checkMsgParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        checkMsgParams.topMargin = dp(14);
        containerChecking.addView(tvCheckingMsg, checkMsgParams);

        card.addView(containerChecking);

        // حاوية نموذج إدخال الكود (Activation Form)
        containerForm = new LinearLayout(this);
        containerForm.setOrientation(LinearLayout.VERTICAL);
        containerForm.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView tvPrompt = new TextView(this);
        tvPrompt.setText("تفعيل عضوية YouTube Premium");
        tvPrompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        tvPrompt.setTextColor(Color.WHITE);
        tvPrompt.setTypeface(Typeface.DEFAULT_BOLD);
        tvPrompt.setGravity(Gravity.CENTER);
        containerForm.addView(tvPrompt);

        TextView tvInstruction = new TextView(this);
        tvInstruction.setText("يرجى إدخال كود التفعيل لتشغيل يوتيوب بدون إعلانات وبالميزات الكاملة");
        tvInstruction.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tvInstruction.setTextColor(Color.parseColor("#AAAAAA"));
        tvInstruction.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams instParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        instParams.topMargin = dp(6);
        containerForm.addView(tvInstruction, instParams);

        // حقل إدخال الكود
        etLicenseKey = new EditText(this);
        etLicenseKey.setHint("PLUS-XXXX-XXXX-XXXX");
        etLicenseKey.setHintTextColor(Color.parseColor("#666666"));
        etLicenseKey.setTextColor(Color.WHITE);
        etLicenseKey.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        etLicenseKey.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        etLicenseKey.setGravity(Gravity.CENTER);
        etLicenseKey.setSingleLine(true);

        GradientDrawable inputBg = new GradientDrawable();
        inputBg.setColor(Color.parseColor("#222222"));
        inputBg.setCornerRadius(dp(12));
        inputBg.setStroke(dp(1), Color.parseColor("#383838"));
        etLicenseKey.setBackground(inputBg);

        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(50)
        );
        inputParams.topMargin = dp(18);
        containerForm.addView(etLicenseKey, inputParams);

        // عرض معرف الجهاز
        TextView tvDevice = new TextView(this);
        tvDevice.setText("معرف جهازك: " + deviceId);
        tvDevice.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tvDevice.setTextColor(Color.parseColor("#777777"));
        tvDevice.setTypeface(Typeface.MONOSPACE);
        tvDevice.setGravity(Gravity.CENTER);
        tvDevice.setPadding(dp(10), dp(5), dp(10), dp(5));

        GradientDrawable devBg = new GradientDrawable();
        devBg.setColor(Color.parseColor("#1B2024"));
        devBg.setCornerRadius(dp(8));
        tvDevice.setBackground(devBg);

        LinearLayout.LayoutParams devParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        devParams.topMargin = dp(12);
        containerForm.addView(tvDevice, devParams);

        tvDevice.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("Device ID", deviceId));
                Toast.makeText(this, "تم نسخ معرف الجهاز", Toast.LENGTH_SHORT).show();
            }
        });

        // رسالة الخطأ / الحالة
        tvStatusMessage = new TextView(this);
        tvStatusMessage.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tvStatusMessage.setTextColor(Color.parseColor("#EF4444"));
        tvStatusMessage.setGravity(Gravity.CENTER);
        tvStatusMessage.setVisibility(View.GONE);

        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusParams.topMargin = dp(12);
        containerForm.addView(tvStatusMessage, statusParams);

        // زر التفعيل
        btnActivate = new Button(this);
        btnActivate.setText("تفعيل وتشغيل الآن");
        btnActivate.setTextColor(Color.WHITE);
        btnActivate.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        btnActivate.setTypeface(Typeface.DEFAULT_BOLD);

        GradientDrawable btnBg = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#FF0000"), Color.parseColor("#CC0000")}
        );
        btnBg.setCornerRadius(dp(12));
        btnActivate.setBackground(btnBg);

        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(50)
        );
        btnParams.topMargin = dp(16);
        containerForm.addView(btnActivate, btnParams);

        btnActivate.setOnClickListener(v -> handleActivationClick());

        progressBarAction = new ProgressBar(this);
        progressBarAction.setVisibility(View.GONE);
        LinearLayout.LayoutParams pbActionParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        pbActionParams.topMargin = dp(12);
        containerForm.addView(progressBarAction, pbActionParams);

        card.addView(containerForm);

        // تذييل الدعم
        TextView tvSupport = new TextView(this);
        tvSupport.setText("للحصول على كود التفعيل أو تجديد الاشتراك تواصل مع الإدارة");
        tvSupport.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tvSupport.setTextColor(Color.parseColor("#555555"));
        tvSupport.setGravity(Gravity.CENTER);

        LinearLayout.LayoutParams supParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        supParams.topMargin = dp(24);
        card.addView(tvSupport, supParams);

        root.addView(card);
        scrollView.addView(root);
        return scrollView;
    }

    private void showFormView() {
        containerChecking.setVisibility(View.GONE);
        containerForm.setVisibility(View.VISIBLE);
        btnActivate.setEnabled(true);
        progressBarAction.setVisibility(View.GONE);
    }

    private void showCheckingView() {
        containerChecking.setVisibility(View.VISIBLE);
        containerForm.setVisibility(View.GONE);
    }

    private void verifySavedLicense(String key) {
        showCheckingView();

        executor.execute(() -> {
            try {
                URL url = new URL(SERVER_URL + "/api/verify");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setDoOutput(true);

                JSONObject payload = new JSONObject();
                payload.put("serial_key", key);
                payload.put("device_id", deviceId);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
                String responseStr = readStream(is);
                JSONObject json = new JSONObject(responseStr.isEmpty() ? "{}" : responseStr);

                mainHandler.post(() -> {
                    if (code == 200 && "valid".equalsIgnoreCase(json.optString("status"))) {
                        launchYouTubePremiumUI();
                    } else {
                        prefs.edit().remove(PREF_KEY_LICENSE).apply();
                        showFormView();
                        showError(json.optString("message", "انتهت مدة صلاحية الكود أو تم إيقافه"));
                    }
                });

            } catch (Exception e) {
                mainHandler.post(() -> {
                    // في حال عدم توفر نت مؤقت نفتح يوتيوب للمشترك أو نطلب إعادة المحاولة
                    launchYouTubePremiumUI();
                });
            }
        });
    }

    private void handleActivationClick() {
        String key = etLicenseKey.getText().toString().trim().toUpperCase();
        if (key.isEmpty()) {
            showError("يرجى إدخال كود التفعيل");
            return;
        }

        btnActivate.setEnabled(false);
        progressBarAction.setVisibility(View.VISIBLE);
        tvStatusMessage.setVisibility(View.GONE);

        executor.execute(() -> {
            try {
                URL url = new URL(SERVER_URL + "/api/activate");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);

                JSONObject payload = new JSONObject();
                payload.put("serial_key", key);
                payload.put("device_id", deviceId);
                payload.put("device_type", "Android");

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
                String responseStr = readStream(is);
                JSONObject json = new JSONObject(responseStr.isEmpty() ? "{}" : responseStr);

                mainHandler.post(() -> {
                    btnActivate.setEnabled(true);
                    progressBarAction.setVisibility(View.GONE);

                    if (code == 200 && "success".equalsIgnoreCase(json.optString("status"))) {
                        prefs.edit().putString(PREF_KEY_LICENSE, key).apply();
                        showSuccess("تم التفعيل بنجاح! جاري فتح يوتيوب بريميوم...");
                        mainHandler.postDelayed(this::launchYouTubePremiumUI, 800);
                    } else {
                        showError(json.optString("message", "كود التفعيل غير صحيح أو مستخدم على جهاز آخر"));
                    }
                });

            } catch (Exception e) {
                mainHandler.post(() -> {
                    btnActivate.setEnabled(true);
                    progressBarAction.setVisibility(View.GONE);
                    showError("تعذر الاتصال بالسيرفر، تأكد من اتصال الإنترنت");
                });
            }
        });
    }

    /**
     * الانتقال إلى واجهة يوتيوب بريميوم الحقيقية والأصلية داخل نفس التطبيق 100%
     */
    private void launchYouTubePremiumUI() {
        String[] targetActivities = {
            TARGET_ACTIVITY_1,
            TARGET_ACTIVITY_2,
            TARGET_ACTIVITY_3
        };

        for (String target : targetActivities) {
            try {
                Class<?> clazz = Class.forName(target);
                Intent intent = new Intent(this, clazz);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(intent);
                finish(); // إغلاق شاشة القفل ليصبح يوتيوب هو النشط
                return;
            } catch (ClassNotFoundException ignored) {}
        }

        // في حال تم تشغيل GatekeeperActivity خارج الحزمة المدمجة
        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage("com.android.youtube.premium");
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(intent);
                finish();
                return;
            }
        } catch (Exception ignored) {}

        showFormView();
        showError("تم التفعيل بنجاح، يرجى إعادة فتح التطبيق لتطبيق التغييرات");
    }

    private void showError(String msg) {
        tvStatusMessage.setText(msg);
        tvStatusMessage.setTextColor(Color.parseColor("#EF4444"));
        tvStatusMessage.setVisibility(View.VISIBLE);
    }

    private void showSuccess(String msg) {
        tvStatusMessage.setText(msg);
        tvStatusMessage.setTextColor(Color.parseColor("#22C55E"));
        tvStatusMessage.setVisibility(View.VISIBLE);
    }

    private String readStream(InputStream in) {
        if (in == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdown();
    }
}

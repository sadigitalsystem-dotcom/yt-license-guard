package com.ytplus.guard;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

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

public class MainActivity extends AppCompatActivity {

    private static final String SERVER_URL = "https://yt-license-guard.onrender.com";
    private static final String PREFS_NAME = "yt_plus_guard_prefs";
    private static final String PREF_KEY_LICENSE = "license_key";
    private static final String PREF_KEY_DEVICE_ID = "fallback_device_id";

    // حزمة تطبيق يوتيوب بلس الأساسي المستخرج من DevRabie YouTube.apk
    private static final String TARGET_PACKAGE_MOD = "com.android.youtube.premium";
    private static final String TARGET_PACKAGE_STOCK = "com.google.android.youtube";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private LinearLayout layoutChecking;
    private TextView tvCheckingMessage;
    private LinearLayout layoutActivationForm;
    private EditText etLicenseKey;
    private TextView tvDeviceId;
    private TextView tvStatusMessage;
    private Button btnActivate;
    private ProgressBar progressBarAction;
    private LinearLayout layoutMissingCompanion;

    private String deviceId;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        initViews();
        resolveDeviceId();

        // فحص ما إذا كان هناك ترخيص مسجل مسبقاً
        String savedLicense = prefs.getString(PREF_KEY_LICENSE, null);
        if (savedLicense != null && !savedLicense.trim().isEmpty()) {
            verifyExistingLicense(savedLicense.trim());
        } else {
            showActivationForm();
        }
    }

    private void initViews() {
        layoutChecking = findViewById(R.id.layoutChecking);
        tvCheckingMessage = findViewById(R.id.tvCheckingMessage);
        layoutActivationForm = findViewById(R.id.layoutActivationForm);
        etLicenseKey = findViewById(R.id.etLicenseKey);
        tvDeviceId = findViewById(R.id.tvDeviceId);
        tvStatusMessage = findViewById(R.id.tvStatusMessage);
        btnActivate = findViewById(R.id.btnActivate);
        progressBarAction = findViewById(R.id.progressBarAction);
        layoutMissingCompanion = findViewById(R.id.layoutMissingCompanion);

        findViewById(R.id.layoutDeviceId).setOnClickListener(v -> copyDeviceIdToClipboard());

        btnActivate.setOnClickListener(v -> handleActivationClick());
    }

    private void resolveDeviceId() {
        try {
            deviceId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception ignored) {
        }

        if (deviceId == null || deviceId.trim().isEmpty() || "9774d56d682e549c".equals(deviceId)) {
            deviceId = prefs.getString(PREF_KEY_DEVICE_ID, null);
            if (deviceId == null) {
                deviceId = "AND-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
                prefs.edit().putString(PREF_KEY_DEVICE_ID, deviceId).apply();
            }
        }

        if (tvDeviceId != null) {
            tvDeviceId.setText(deviceId);
        }
    }

    private void copyDeviceIdToClipboard() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null && deviceId != null) {
            ClipData clip = ClipData.newPlainText("Device ID", deviceId);
            clipboard.setPrimaryClip(clip);
            Toast.makeText(this, "تم نسخ معرف الجهاز إلى الحافظة", Toast.LENGTH_SHORT).show();
        }
    }

    private void showCheckingScreen(String message) {
        layoutChecking.setVisibility(View.VISIBLE);
        layoutActivationForm.setVisibility(View.GONE);
        layoutMissingCompanion.setVisibility(View.GONE);
        if (message != null) {
            tvCheckingMessage.setText(message);
        }
    }

    private void showActivationForm() {
        layoutChecking.setVisibility(View.GONE);
        layoutActivationForm.setVisibility(View.VISIBLE);
        progressBarAction.setVisibility(View.GONE);
        btnActivate.setEnabled(true);
    }

    private void verifyExistingLicense(String key) {
        showCheckingScreen(getString(R.string.status_checking));

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
                        launchTargetYouTubeApp();
                    } else {
                        // الكود ملغى أو منتهي
                        prefs.edit().remove(PREF_KEY_LICENSE).apply();
                        showActivationForm();
                        String errorMsg = json.optString("message", getString(R.string.error_connection));
                        showError(errorMsg);
                    }
                });

            } catch (Exception e) {
                mainHandler.post(() -> {
                    // في حال انقطاع النت المؤقت، إذا كان هناك ترخيص مسجل يمكننا السماح أو طلب إعادة التحقق
                    showActivationForm();
                    showError(getString(R.string.error_connection));
                });
            }
        });
    }

    private void handleActivationClick() {
        String key = etLicenseKey.getText().toString().trim().toUpperCase();
        if (key.isEmpty()) {
            showError(getString(R.string.error_empty_key));
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

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
                String responseStr = readStream(is);
                JSONObject json = new JSONObject(responseStr.isEmpty() ? "{}" : responseStr);

                mainHandler.post(() -> {
                    progressBarAction.setVisibility(View.GONE);
                    btnActivate.setEnabled(true);

                    if (code == 200 && "success".equalsIgnoreCase(json.optString("status"))) {
                        // حفظ الكود محلياً
                        prefs.edit().putString(PREF_KEY_LICENSE, key).apply();
                        showSuccess(getString(R.string.success_activated));

                        // تأخير ثانية ليرى المستخدم رسالة النجاح ثم تشغيل يوتيوب
                        mainHandler.postDelayed(this::launchTargetYouTubeApp, 1000);
                    } else {
                        String msg = json.optString("message", getString(R.string.error_connection));
                        showError(msg);
                    }
                });

            } catch (Exception e) {
                mainHandler.post(() -> {
                    progressBarAction.setVisibility(View.GONE);
                    btnActivate.setEnabled(true);
                    showError(getString(R.string.error_connection));
                });
            }
        });
    }

    private void launchTargetYouTubeApp() {
        PackageManager pm = getPackageManager();

        // 1. فحص تطبيق يوتيوب بلس الأساسي (النسخة المعدلة الخالية من الإعلانات)
        Intent launchIntent = pm.getLaunchIntentForPackage(TARGET_PACKAGE_MOD);

        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launchIntent);
            finish(); // إغلاق شاشة القفل ليصبح يوتيوب هو النشط
            return;
        }

        // 2. إذا لم يكن مثبتاً، فحص تطبيق يوتيوب الرسمي كبديل
        launchIntent = pm.getLaunchIntentForPackage(TARGET_PACKAGE_STOCK);
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launchIntent);
            finish();
            return;
        }

        // 3. في حال عدم وجود أي منهما، إظهار رسالة إرشادية لتثبيت التطبيق المرفق
        showActivationForm();
        layoutMissingCompanion.setVisibility(View.VISIBLE);
        showError(getString(R.string.error_not_installed));
    }

    private void showError(String msg) {
        tvStatusMessage.setText(msg);
        tvStatusMessage.setTextColor(getResources().getColor(R.color.status_error));
        tvStatusMessage.setVisibility(View.VISIBLE);
    }

    private void showSuccess(String msg) {
        tvStatusMessage.setText(msg);
        tvStatusMessage.setTextColor(getResources().getColor(R.color.status_success));
        tvStatusMessage.setVisibility(View.VISIBLE);
    }

    private String readStream(InputStream in) {
        if (in == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
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

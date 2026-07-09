package com.blazinsan.yournotes;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInitialSystemBarStyle();
        preferHighestRefreshRate();
        installWebBackHandler();
        installRenderCrashRecovery();
    }

    // The WebView renderer occasionally dies (OOM on huge images, autofill CHECK
    // crashes on some OEM WebView builds). Without this handler Android kills the
    // whole app — with it we reload the page and the user just sees the UI
    // restart, data intact (everything persists in localStorage/native store).
    private void installRenderCrashRecovery() {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                view.post(() -> {
                    try {
                        view.reload();
                    } catch (Throwable t) {
                        recreate();
                    }
                });
                return true; // handled — do NOT kill the app process
            }
        });
    }

    private void applyInitialSystemBarStyle() {
        Window window = getWindow();
        int surface = Color.parseColor("#FDFBF7");

        window.setStatusBarColor(surface);
        window.setNavigationBarColor(surface);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }

    private void installWebBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchBackToWebApp();
            }
        });
    }

    private void dispatchBackToWebApp() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().evaluateJavascript(
                "window.__ynNativeBack ? window.__ynNativeBack() : true;",
                null
        );
    }

    private void preferHighestRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }

        Display display = getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        Display.Mode best = current;

        for (Display.Mode mode : display.getSupportedModes()) {
            boolean sameResolution = mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight();
            if (sameResolution && mode.getRefreshRate() > best.getRefreshRate()) {
                best = mode;
            }
        }

        WindowManager.LayoutParams attrs = getWindow().getAttributes();
        attrs.preferredDisplayModeId = best.getModeId();
        attrs.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(attrs);
    }
}

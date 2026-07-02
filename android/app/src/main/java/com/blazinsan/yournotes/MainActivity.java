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

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInitialSystemBarStyle();
        preferHighestRefreshRate();
        installWebBackHandler();
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

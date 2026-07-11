package com.blazinsan.yournotes;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.Window;
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
        installWebBackHandler();
        installRenderCrashRecovery();
    }

    // A WebView whose renderer has exited is permanently unusable. Remove and
    // destroy that instance, then recreate the Activity so Capacitor constructs a
    // fresh Bridge/WebView. Calling reload() on the dead WebView is unsupported.
    private void installRenderCrashRecovery() {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                String rendererDetails = "details unavailable below API 26";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    rendererDetails = "didCrash=" + detail.didCrash()
                            + ", priority=" + detail.rendererPriorityAtExit();
                }
                Log.e("YourNotes", "WebView renderer exited; recreating activity. "
                        + rendererDetails);
                runOnUiThread(() -> {
                    try {
                        ViewParent parent = view.getParent();
                        if (parent instanceof ViewGroup) {
                            ((ViewGroup) parent).removeView(view);
                        }
                        view.destroy();
                    } catch (Throwable cleanupError) {
                        Log.e("YourNotes", "Failed to clean up dead WebView", cleanupError);
                    }
                    if (!isFinishing() && !isDestroyed()) recreate();
                });
                return true;
            }
        });
    }

    private void applyInitialSystemBarStyle() {
        Window window = getWindow();
        // Match the launch bars to the active theme. Hardcoding light cream stomped
        // the values-night theme at runtime (light bars + dark icons on a dark app).
        boolean night = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int surface = Color.parseColor(night ? "#12100E" : "#FDFBF7");

        window.setStatusBarColor(surface);
        window.setNavigationBarColor(surface);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!night);
        controller.setAppearanceLightNavigationBars(!night);
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

}

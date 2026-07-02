package com.blazinsan.yournotes;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInitialSystemBarStyle();
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
}

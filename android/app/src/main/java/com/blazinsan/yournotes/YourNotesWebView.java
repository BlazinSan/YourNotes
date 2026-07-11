package com.blazinsan.yournotes;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.webkit.WebView;

/** Prevents broken OEM/ColorOS text action windows; the app supplies a safe menu. */
public class YourNotesWebView extends WebView {
    public YourNotesWebView(Context context) { super(context); }
    public YourNotesWebView(Context context, AttributeSet attrs) { super(context, attrs); }
    public YourNotesWebView(Context context, AttributeSet attrs, int style) { super(context, attrs, style); }

    @Override public ActionMode startActionMode(ActionMode.Callback callback) { return null; }
    @Override public ActionMode startActionMode(ActionMode.Callback callback, int type) { return null; }
}

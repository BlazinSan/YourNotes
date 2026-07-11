package com.blazinsan.yournotes;

import android.content.Context;
import android.util.AttributeSet;
import android.webkit.WebView;

/** Standard WebView with the phone's native text selection and action mode. */
public class YourNotesWebView extends WebView {
    public YourNotesWebView(Context context) { super(context); }
    public YourNotesWebView(Context context, AttributeSet attrs) { super(context, attrs); }
    public YourNotesWebView(Context context, AttributeSet attrs, int style) { super(context, attrs, style); }
}

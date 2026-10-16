# Keep the methods the CRM page calls through the JavaScript bridge
-keepclassmembers class in.apjtech.crm.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes *Annotation*,JavascriptInterface

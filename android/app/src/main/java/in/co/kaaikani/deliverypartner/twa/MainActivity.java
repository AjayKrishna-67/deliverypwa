package in.co.kaaikani.deliverypartner.twa;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void setContentView(int layoutResID) {
        // BridgeActivity inflates Capacitor's own layout and then looks the
        // WebView up by id, so this is the only hook to hand it our subclass.
        if ("capacitor_bridge_layout_main".equals(getResources().getResourceEntryName(layoutResID))) {
            layoutResID = R.layout.keepalive_bridge_layout;
        }
        super.setContentView(layoutResID);
    }
}

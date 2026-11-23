package in.co.kaaikani.deliverypartner.twa;

import android.app.ActivityManager;
import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

/**
 * Keeps the page "visible" to Chromium while a delivery is being tracked and
 * the screen is off or the app is backgrounded. Blink freezes a hidden page
 * about a minute after it stops being visible: JavaScript stops, the GPS fixes
 * the location foreground service keeps delivering queue up in the bridge, and
 * no heartbeat reaches the backend until the screen comes back — the fleet
 * page shows the rider Inactive mid-ride. Window visibility is the only signal
 * Chromium uses for that, so we report VISIBLE whenever the tracking service is
 * running; nothing is drawn while the window is gone. Outside a ride the page
 * hides normally, so an idle app in the background still sleeps.
 */
public class KeepAliveWebView extends CapacitorWebView {

    private static final String TRACKING_SERVICE =
        "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService";

    public KeepAliveWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (visibility != View.VISIBLE && isTrackingRide()) {
            visibility = View.VISIBLE;
        }
        super.onWindowVisibilityChanged(visibility);
    }

    /** True while the ride watcher's foreground service is up. */
    private boolean isTrackingRide() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        try {
            // Deprecated for other apps' services but still lists our own.
            for (ActivityManager.RunningServiceInfo s : am.getRunningServices(Integer.MAX_VALUE)) {
                if (s.foreground && TRACKING_SERVICE.equals(s.service.getClassName())) return true;
            }
        } catch (SecurityException ignored) {
            // Nothing to do — treat as not tracking.
        }
        return false;
    }
}

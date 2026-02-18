package com.systemreg.hrcam;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Proximity")
public class ProximityPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensorManager;
    private Sensor proximitySensor;
    private boolean isListening = false;

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            proximitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensorManager == null || proximitySensor == null) {
            call.reject("Proximity sensor is not available on this device");
            return;
        }

        if (!isListening) {
            sensorManager.registerListener(this, proximitySensor, SensorManager.SENSOR_DELAY_NORMAL);
            isListening = true;
        }

        JSObject result = new JSObject();
        result.put("available", true);
        result.put("maxDistance", proximitySensor.getMaximumRange());
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopListening();
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.sensor == null || event.sensor.getType() != Sensor.TYPE_PROXIMITY) {
            return;
        }
        float distance = event.values[0];
        float maxDistance = proximitySensor != null ? proximitySensor.getMaximumRange() : distance;
        boolean near = distance < maxDistance;

        JSObject payload = new JSObject();
        payload.put("near", near);
        payload.put("distance", distance);
        payload.put("maxDistance", maxDistance);
        notifyListeners("proximityChange", payload);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // No-op
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (sensorManager != null && proximitySensor != null && hasListeners("proximityChange") && !isListening) {
            sensorManager.registerListener(this, proximitySensor, SensorManager.SENSOR_DELAY_NORMAL);
            isListening = true;
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        stopListening();
    }

    @Override
    protected void handleOnDestroy() {
        stopListening();
        super.handleOnDestroy();
    }

    private void stopListening() {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
            isListening = false;
        }
    }
}

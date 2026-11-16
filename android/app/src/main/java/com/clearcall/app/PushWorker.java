package com.clearcall.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public class PushWorker extends Worker {

    private static final String KEY_TITLE = "title";
    private static final String KEY_BODY = "body";

    public PushWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String title = getInputData().getString(KEY_TITLE);
        String body = getInputData().getString(KEY_BODY);
        NotificationHelper.show(getApplicationContext(), title, body);
        return Result.success();
    }

    static void enqueue(Context context, String title, String body, long delayMillis) {
        Data data = new Data.Builder()
                .putString(KEY_TITLE, title)
                .putString(KEY_BODY, body)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(PushWorker.class)
                .setInputData(data)
                .setInitialDelay(Math.max(0, delayMillis), TimeUnit.MILLISECONDS)
                .build();
        WorkManager.getInstance(context).enqueue(request);
    }
}

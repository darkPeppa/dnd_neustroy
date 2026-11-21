plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val releaseVersion = rootProject.file("../VERSION").readText().trim()
val versionParts = releaseVersion.split(".").map(String::toInt)

android {
    namespace = "ru.neustroy.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "ru.neustroy.app"
        minSdk = 26
        targetSdk = 36
        versionCode = versionParts[0] * 1_000_000 + versionParts[1] * 1_000 + versionParts[2]
        versionName = releaseVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        getByName("debug") { storeFile = rootProject.file("../.local/android-debug.keystore") }
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":shared"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
}

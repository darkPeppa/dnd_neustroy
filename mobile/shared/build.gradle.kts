import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("com.android.library")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin {
    androidTarget { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    jvm("desktop") { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    // Android builds do not need Xcode or the Kotlin/Native toolchain.
    if (providers.gradleProperty("enableIos").orNull == "true") {
        listOf(iosArm64(), iosSimulatorArm64(), iosX64()).forEach {
            it.binaries.framework {
                baseName = "NeustroyKit"
                isStatic = true
            }
        }
    }
    sourceSets.all { languageSettings.optIn("kotlin.time.ExperimentalTime") }
    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.components.resources)
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.7.1")
            implementation("io.ktor:ktor-client-core:3.3.1")
        }
        androidMain.dependencies { implementation("io.ktor:ktor-client-okhttp:3.3.1") }
        val desktopMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-okhttp:3.3.1")
                implementation(compose.desktop.currentOs)
            }
        }
        if (providers.gradleProperty("enableIos").orNull == "true") {
            iosMain.dependencies { implementation("io.ktor:ktor-client-darwin:3.3.1") }
        }
        commonTest.dependencies {
            implementation("io.ktor:ktor-client-mock:3.3.1")
            implementation(kotlin("test"))
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
        }
    }
}

android {
    namespace = "ru.neustroy.shared"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

compose.resources {
    packageOfResClass = "ru.neustroy.resources"
    generateResClass = always
}

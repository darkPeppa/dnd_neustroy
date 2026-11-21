plugins {
    id("com.diffplug.spotless") version "7.0.4"
    kotlin("multiplatform") version "2.2.21" apply false
    kotlin("android") version "2.2.21" apply false
    kotlin("jvm") version "2.2.21" apply false
    kotlin("plugin.serialization") version "2.2.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.21" apply false
    id("org.jetbrains.compose") version "1.9.3" apply false
    id("com.android.application") version "8.11.1" apply false
    id("com.android.library") version "8.11.1" apply false
}

spotless {
    kotlin {
        target("**/src/**/*.kt")
        ktfmt("0.54").kotlinlangStyle()
    }
    kotlinGradle {
        target("*.gradle.kts", "*/build.gradle.kts")
        ktfmt("0.54").kotlinlangStyle()
    }
}

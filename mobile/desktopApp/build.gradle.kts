import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    kotlin("jvm")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
    implementation("org.apache.pdfbox:pdfbox:3.0.8")
}

compose.desktop {
    application {
        mainClass = "ru.neustroy.desktop.MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "neustroy"
            packageVersion = "1.0.0"
            description = "Листы персонажей и инструменты для настольных игр"
            vendor = "neustroy"
            modules("java.desktop", "java.net.http", "jdk.unsupported")
            windows {
                menuGroup = "neustroy"
                shortcut = true
                upgradeUuid = "9184a258-657b-45f1-a483-0a523ef908d9"
            }
        }
    }
}

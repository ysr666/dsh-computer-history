// The JetBrains client for Computer History: an IntelliJ Platform plugin that reports which file the editor
// is showing, using the editor companion contract the Host already defines (EditorCompanionPayload).
//
// It is not a collector. It observes nothing outside its own process, sends no text, and declares its identity
// as a claim - `app.bundleId` / `app.name` are what this plugin says it is, which the Host validates by shape
// and then judges against its allow-list like any other observation (ADR 0011).
plugins {
  kotlin("jvm") version "2.1.0"
  id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "dev.dsh"
version = "0.1.0"

repositories {
  mavenCentral()
  intellijPlatform {
    defaultRepositories()
  }
}

dependencies {
  // The installed IDE instead of a downloaded one: the plugin is built and run against the same build the
  // user has, which is both what "verified on this machine" means and 1 GB less traffic.
  intellijPlatform {
    local("/Applications/IntelliJ IDEA CE.app")
  }
}

intellijPlatform {
  pluginConfiguration {
    name = "Computer History Companion"
    description = """
      Reports the file the editor is showing to a local DeepSeek Harness Computer History intake.
      Metadata only: paths and identifiers, never file contents, selections or keystrokes.
    """.trimIndent()
    ideaVersion {
      sinceBuild = "242"
    }
  }
}

kotlin {
  jvmToolchain(21)
}

// Where the intake listens and which token it expects. Deliberately not baked into the plugin: the pairing
// token is per-installation, and a token in a jar is a token in a repository.
tasks.named<JavaExec>("runIde") {
  listOf("computer-history.port", "computer-history.token").forEach { key ->
    providers.systemProperty(key).orNull?.let { jvmArgs("-D$key=$it") }
  }
}

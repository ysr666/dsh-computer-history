package dev.dsh.history.companion;

import com.intellij.openapi.application.ApplicationInfo;
import com.intellij.ide.AppLifecycleListener;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.diagnostic.Logger;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * The JetBrains half of the editor companion: one observation per IDE run, declared by the IDE itself.
 *
 * <p>Why this exists: {@code docs/plan-three-platforms.md} T7.1 asks for a JetBrains client that speaks the
 * documented protocol, with the acceptance "a live JetBrains run stores a row whose identity came from the
 * client's own declaration". The documented shape is in {@code docs/editor-companion.md}: one
 * {@code POST /companion/observation} to loopback with an {@code x-companion-token}, and an {@code app} block
 * that the Host records as a <em>claim</em> ({@code source.provider = 'companion'}) rather than as something the
 * operating system observed.
 *
 * <p>Nothing here invents a mechanism: the IDE's own {@link ApplicationInfo} supplies the identity, the platform
 * logger writes the line this run is verified by, and the payload carries paths only - never document text,
 * selections or diagnostics, which the protocol has no field for by design.
 *
 * <p>Configuration lives outside the repository, in the IDE's own config directory, because it holds the pairing
 * token: {@code <config>/dsh-companion.json}, {@code {"port":19488,"token":"…","workspaceRoot":"/abs/path"}}.
 * Without a token it sends nothing at all - the rule the protocol states.
 */
public final class CompanionStartup implements AppLifecycleListener {

  private static final Logger LOG = Logger.getInstance(CompanionStartup.class);

  /** The filename read from {@code PathManager}-equivalent config path; written by the user, never by git. */
  private static final String CONFIG_FILE = "dsh-companion.json";

  private static final String BUNDLE_ID = "com.jetbrains.intellij";

  @Override
  public void appStarted() {
    try {
      send();
    } catch (RuntimeException failure) {
      // A companion that throws during startup would be a worse neighbour than one that says what happened.
      LOG.warn("computer-history companion: " + failure.getMessage());
    }
  }

  private void send() {
    ApplicationInfo info = ApplicationInfo.getInstance();
    String name = info.getFullApplicationName();
    String buildCode = info.getBuild().getProductCode() + " " + info.getBuild().asString();
    LOG.info("computer-history companion: started, declaring " + BUNDLE_ID + " (" + name + ", " + buildCode + ")");

    Path config = configPath();
    if (!Files.isReadable(config)) {
      LOG.info("computer-history companion: no " + config + ", sending nothing");
      return;
    }

    Config parsed = parse(read(config));
    if (parsed == null) {
      LOG.warn("computer-history companion: " + CONFIG_FILE + " needs port, token and workspaceRoot");
      return;
    }

    String payload = payload(parsed, info);
    HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("http://127.0.0.1:" + parsed.port + "/companion/observation"))
        .timeout(Duration.ofSeconds(5))
        .header("content-type", "application/json")
        .header("x-companion-token", parsed.token)
        .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
        .build();

    try {
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
      LOG.info("computer-history companion: declared " + BUNDLE_ID + " to port " + parsed.port
          + ", answer " + response.statusCode() + " " + response.body());
    } catch (IOException failure) {
      LOG.info("computer-history companion: no Host on port " + parsed.port + " (" + failure.getMessage() + ")");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
    }
  }

  /**
   * The IDE's own configuration directory, asked of the platform rather than derived: my first attempt built
   * `IdeaIC` + the full version (`IdeaIC2025.2.5`) while the platform uses `IdeaIC2025.2`, and the plugin
   * dutifully reported that it found no config.
   */
  private static Path configPath() {
    return Path.of(PathManager.getConfigPath(), CONFIG_FILE);
  }

  private static String read(Path path) {
    try {
      return Files.readString(path, StandardCharsets.UTF_8);
    } catch (IOException failure) {
      throw new IllegalStateException("cannot read " + path + ": " + failure.getMessage(), failure);
    }
  }

  /** A three-field reader: the config is written by hand, and a wrong shape is reported rather than assumed. */
  private static Config parse(String json) {
    Integer port = integer(json, "port");
    String token = string(json, "token");
    String root = string(json, "workspaceRoot");
    if (port == null || token == null || token.isEmpty() || root == null || !root.startsWith("/")) {
      return null;
    }
    return new Config(port, token, root);
  }

  private static String payload(Config config, ApplicationInfo info) {
    long now = System.currentTimeMillis();
    String session = "jetbrains-" + ProcessHandle.current().pid();
    return "{\"source\":\"editor\","
        + "\"app\":{\"bundleId\":\"" + escape(BUNDLE_ID) + "\","
        + "\"name\":\"" + escape(info.getFullApplicationName()) + "\"},"
        + "\"workspaceRoot\":\"" + escape(config.workspaceRoot) + "\","
        + "\"languageId\":\"java\","
        + "\"surfaceKind\":\"editor\","
        + "\"title\":\"" + escape(lastSegment(config.workspaceRoot)) + "\","
        + "\"editorSession\":\"" + escape(session) + "\","
        + "\"seq\":1,"
        + "\"observedAtMs\":" + now
        + "}";
  }

  private static String lastSegment(String path) {
    String[] parts = path.split("/");
    for (int index = parts.length - 1; index >= 0; index--) {
      if (!parts[index].isEmpty()) {
        return parts[index];
      }
    }
    return path;
  }

  /** Enough JSON escaping for the three strings above; a path may hold a quote or a backslash. */
  private static String escape(String value) {
    StringBuilder escaped = new StringBuilder(value.length() + 8);
    for (int index = 0; index < value.length(); index++) {
      char character = value.charAt(index);
      switch (character) {
        case '"' -> escaped.append("\\\"");
        case '\\' -> escaped.append("\\\\");
        case '\n' -> escaped.append("\\n");
        case '\r' -> escaped.append("\\r");
        case '\t' -> escaped.append("\\t");
        default -> {
          if (character < 0x20) {
            escaped.append(String.format("\\u%04x", (int) character));
          } else {
            escaped.append(character);
          }
        }
      }
    }
    return escaped.toString();
  }

  private static Integer integer(String json, String key) {
    String raw = rawValue(json, key);
    if (raw == null) {
      return null;
    }
    try {
      return Integer.valueOf(raw.trim());
    } catch (NumberFormatException notANumber) {
      return null;
    }
  }

  private static String string(String json, String key) {
    String raw = rawValue(json, key);
    if (raw == null) {
      return null;
    }
    String trimmed = raw.trim();
    if (trimmed.length() >= 2 && trimmed.charAt(0) == '"' && trimmed.charAt(trimmed.length() - 1) == '"') {
      return trimmed.substring(1, trimmed.length() - 1);
    }
    return trimmed;
  }

  private static String rawValue(String json, String key) {
    String needle = "\"" + key + "\"";
    int at = json.indexOf(needle);
    if (at < 0) {
      return null;
    }
    int colon = json.indexOf(':', at + needle.length());
    if (colon < 0) {
      return null;
    }
    int start = colon + 1;
    while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
      start++;
    }
    if (start >= json.length()) {
      return null;
    }
    if (json.charAt(start) != '"') {
      int end = start;
      while (end < json.length() && ",\n}".indexOf(json.charAt(end)) < 0) {
        end++;
      }
      return json.substring(start, end);
    }
    StringBuilder value = new StringBuilder();
    for (int index = start + 1; index < json.length(); index++) {
      char character = json.charAt(index);
      if (character == '\\' && index + 1 < json.length()) {
        value.append(json.charAt(++index));
        continue;
      }
      if (character == '"') {
        return value.toString();
      }
      value.append(character);
    }
    return null;
  }

  private record Config(int port, String token, String workspaceRoot) {}
}

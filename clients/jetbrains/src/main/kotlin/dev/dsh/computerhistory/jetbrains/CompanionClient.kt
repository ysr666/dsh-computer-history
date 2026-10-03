package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.application.ApplicationInfo
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger

/**
 * The intake client.
 *
 * It speaks the editor companion contract the Host already defines: `POST /companion/observation` with an
 * `x-companion-token` header and an `EditorCompanionPayload` body. There is no second protocol here, and
 * deliberately no room for one: the payload type has no field that could carry file contents, selections or
 * keystrokes, and the intake refuses unknown fields rather than ignoring them.
 *
 * Configuration comes from system properties - `computer-history.port` and `computer-history.token` - because
 * the pairing token is per-installation and a token compiled into a plugin is a token in a repository. With no
 * token the client stays silent and says so once in the log, rather than posting something the Host will refuse.
 */
object CompanionClient {
    private val log: Logger = Logger.getLogger("computer-history.jetbrains")

    private val session: String = UUID.randomUUID().toString()
    private val sequence = AtomicInteger(0)
    private val http: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .build()

    val port: Int = System.getProperty("computer-history.port")?.toIntOrNull() ?: 19388
    val token: String = System.getProperty("computer-history.token") ?: ""

    private var warnedAboutToken = false

    /**
     * What this plugin says it is. The Host treats it as a claim, not as something the operating system
     * observed, so it is reported with the product code it was actually built against.
     */
    fun declaredApp(): Pair<String, String> {
        val info = ApplicationInfo.getInstance()
        val product = info.build.productCode
        val family = when (product.uppercase()) {
            "IC", "IU" -> "intellij"
            "PY" -> "pycharm"
            "GO" -> "goland"
            "CL" -> "clion"
            "WS" -> "webstorm"
            "RD" -> "rider"
            "DB" -> "datagrip"
            "RR" -> "rustrover"
            else -> product.lowercase()
        }
        return "com.jetbrains.$family" to info.fullApplicationName
    }

    fun report(
        workspaceRoot: String,
        filePath: String? = null,
        languageId: String? = null,
        surfaceKind: String? = null,
        title: String? = null,
    ) {
        if (token.isEmpty()) {
            if (!warnedAboutToken) {
                warnedAboutToken = true
                log.info(
                    "computer-history: no pairing token set (-Dcomputer-history.token=…); " +
                        "nothing will be reported",
                )
            }
            return
        }
        val (bundleId, name) = declaredApp()
        val body = buildString {
            append("{")
            append("\"source\":\"editor\",")
            append("\"app\":{")
            append("\"bundleId\":").append(quote(bundleId)).append(",")
            append("\"name\":").append(quote(name))
            append("},")
            append("\"workspaceRoot\":").append(quote(workspaceRoot)).append(",")
            filePath?.let { append("\"filePath\":").append(quote(it)).append(",") }
            languageId?.let { append("\"languageId\":").append(quote(it)).append(",") }
            surfaceKind?.let { append("\"surfaceKind\":").append(quote(it)).append(",") }
            title?.let { append("\"title\":").append(quote(it)).append(",") }
            append("\"editorSession\":").append(quote(session)).append(",")
            append("\"seq\":").append(sequence.incrementAndGet()).append(",")
            append("\"observedAtMs\":").append(System.currentTimeMillis())
            append("}")
        }
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port/companion/observation"))
            .timeout(Duration.ofSeconds(3))
            .header("content-type", "application/json")
            .header("x-companion-token", token)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        // Fire and forget: an editor must not wait on the intake, and a refused report is a log line rather
        // than a dialog. The status is logged because "it did nothing" and "it was refused" look the same.
        http.sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .thenAccept { response ->
                // Both outcomes are logged: a report that was accepted and one that was refused look identical
                // from the outside, and the acceptance for this client asks for the client's own log.
                val detail = response.body().take(120)
                log.info("computer-history: intake answered ${response.statusCode()} for $workspaceRoot$detail")
            }
            .exceptionally { error ->
                log.info("computer-history: intake unreachable (${error.message})")
                null
            }
    }

    /** Minimal JSON string escaping; the payload carries paths, which contain backslashes on Windows. */
    internal fun quote(value: String): String {
        val out = StringBuilder("\"")
        for (character in value) {
            when (character) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (character < ' ') out.append("\\u%04x".format(character.code)) else out.append(character)
            }
        }
        return out.append("\"").toString()
    }
}

package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import java.io.File

/**
 * The workspace root to declare for a file.
 *
 * The intake enforces `filePath must live under workspaceRoot`, and the first version of this client broke that
 * invariant in a way worth keeping: opening a single file makes the IDE use *LightEdit*, where
 * `project.basePath` is the IDE's own configuration directory - so the client claimed a workspace in
 * Application Support and sent a file from /tmp, and the Host refused it with exactly that message.
 *
 * The rule is therefore: a real project's base path when the file is inside it, and otherwise the file's own
 * directory. That is not a workaround; in IightEdit the file *is* the workspace, and claiming otherwise would
 * be a false statement about where the work happened.
 */
internal fun workspaceRootFor(project: Project, file: VirtualFile): String {
    val base = project.basePath
    val filePath = File(file.path)
    if (base != null && filePath.path.startsWith("$base${File.separator}")) return base
    return filePath.parent ?: filePath.path
}

package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import java.util.logging.Logger

/**
 * Reports the workspace once, when a project opens.
 *
 * The workspace root is the only thing known this early, and it is enough for a "which project was I in"
 * question that the file-level reports then refine.
 */
class ProjectReporter : ProjectActivity {
    override suspend fun execute(project: Project) {
        // The default project's base path is the IDE's configuration directory: reporting it as a workspace
        // would be a claim about where work happened that is simply not true.
        if (project.isDefault) return
        val root = project.basePath ?: return
        Logger.getLogger("computer-history.jetbrains")
            .info("computer-history: project opened, reporting $root")
        CompanionClient.report(workspaceRoot = root, title = project.name)
        // A file given on the command line is already open by now, and the editor event for it has already
        // happened: report what the editor is showing, not only what happens next.
        FileEditorManager.getInstance(project).selectedFiles.firstOrNull()?.let { file ->
            CompanionClient.report(
                workspaceRoot = root,
                filePath = file.path,
                languageId = file.fileType.name.lowercase(),
                surfaceKind = "editor",
                title = file.name,
            )
        }
    }
}

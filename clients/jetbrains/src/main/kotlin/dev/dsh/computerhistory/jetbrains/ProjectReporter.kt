package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

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
        CompanionClient.report(workspaceRoot = root, title = project.name)
    }
}

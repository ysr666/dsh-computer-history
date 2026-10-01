import Foundation

func phase1AdapterForBundle(
    _ bundle: String
) -> String? {
    if bundle == "com.microsoft.VSCode"
        || bundle == "com.todesktop.230313mzl4w4u92" {
        return "vscode"
    }
    if bundle == "com.apple.Terminal"
        || bundle == "com.googlecode.iterm2" {
        return "terminal"
    }
    if bundle == "com.apple.Preview" {
        return "preview"
    }
    if bundle == "com.apple.finder" {
        return "finder"
    }
    return nil
}

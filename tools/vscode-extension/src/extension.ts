import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

class RobotickViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose() {
    // nothing to cleanup yet
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };

    const rendererDir = path.join(
      this.context.extensionPath,
      "media",
      "renderer"
    );
    const indexHtmlPath = path.join(rendererDir, "index.html");

    if (fs.existsSync(indexHtmlPath)) {
      const rendererUri = vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "renderer"
      );
      let html = fs.readFileSync(indexHtmlPath, "utf8");
      const baseHref = webviewView.webview.asWebviewUri(rendererUri);
      html = html.replace(
        "<head>",
        `<head><base href="${baseHref.toString()}/">`
      );
      webviewView.webview.html = html;
      return;
    }

    webviewView.webview.html = this.getFallbackHtml();
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
  <body>
    <p style="padding: 16px;">
      Robotick renderer bundle not found. Run <code>npm run build</code> at the repo root
      before packaging the VS Code extension.
    </p>
  </body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new RobotickViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("robotick.view", provider)
  );

  const command = vscode.commands.registerCommand("robotick.openPanel", () => {
    vscode.commands.executeCommand("workbench.view.extension.robotick");
  });

  context.subscriptions.push(provider, command);
}

export function deactivate() {}

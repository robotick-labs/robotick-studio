import * as vscode from "vscode";

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

    const iconUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "robotick-icon.png")
    );

    webviewView.webview.html = this.getHtml(iconUri.toString());
  }

  private getHtml(iconSrc: string): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Robotick</title>
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        gap: 8px;
      }
      img { width: 64px; height: 64px; }
    </style>
  </head>
  <body>
    <img src="${iconSrc}" alt="Robotick" />
    <h2>Robotick</h2>
    <p>Welcome to the Robotick extension.</p>
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

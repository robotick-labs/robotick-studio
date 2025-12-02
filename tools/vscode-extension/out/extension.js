"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
class RobotickViewProvider {
    constructor(context) {
        this.context = context;
    }
    dispose() {
        // nothing to cleanup yet
    }
    resolveWebviewView(webviewView) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "media"),
            ],
        };
        const iconUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "robotick-icon.png"));
        webviewView.webview.html = this.getHtml(iconUri.toString());
    }
    getHtml(iconSrc) {
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
function activate(context) {
    const provider = new RobotickViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("robotick.view", provider));
    const command = vscode.commands.registerCommand("robotick.openPanel", () => {
        vscode.commands.executeCommand("workbench.view.extension.robotick");
    });
    context.subscriptions.push(provider, command);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map
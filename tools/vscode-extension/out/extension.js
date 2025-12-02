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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
        const rendererDir = path.join(this.context.extensionPath, "media", "renderer");
        const indexHtmlPath = path.join(rendererDir, "index.html");
        if (fs.existsSync(indexHtmlPath)) {
            const rendererUri = vscode.Uri.joinPath(this.context.extensionUri, "media", "renderer");
            let html = fs.readFileSync(indexHtmlPath, "utf8");
            const baseHref = webviewView.webview.asWebviewUri(rendererUri);
            html = html.replace("<head>", `<head><base href="${baseHref.toString()}/">`);
            webviewView.webview.html = html;
            return;
        }
        webviewView.webview.html = this.getFallbackHtml();
    }
    getFallbackHtml() {
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
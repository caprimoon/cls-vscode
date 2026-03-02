const vscode = require("vscode");
const axios = require("axios");
const cheerio = require("cheerio");

// 保存电报数据
let telegraphData = [];
// 保存已通知的电报ID
let notifiedTelegraphIds = new Set();
// 自动刷新定时器
let autoRefreshTimer = null;
// 保存打开的文档URI
let openedDocumentUris = new Set();

// 侧边栏数据提供者
class TelegraphDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      // 返回电报列表
      return telegraphData.map((item, index) => {
        const treeItem = new vscode.TreeItem(
          `电报 ${index + 1}`,
          vscode.TreeItemCollapsibleState.None,
        );
        treeItem.command = {
          command: "cls-telegraph.viewTelegraph",
          title: "查看详情",
          arguments: [index],
        };
        // 截取部分内容作为描述
        const preview =
          item.content.length > 50
            ? item.content.substring(0, 50) + "..."
            : item.content;
        treeItem.description = preview;
        // 如果是新电报，添加特殊标记
        if (item.isNew) {
          treeItem.iconPath = new vscode.ThemeIcon("new-file");
        }
        return treeItem;
      });
    }
    return [];
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log("财联社电报查看器插件已激活");

  // 创建数据提供者
  const telegraphDataProvider = new TelegraphDataProvider();

  // 注册侧边栏视图
  vscode.window.registerTreeDataProvider(
    "clsTelegraphList",
    telegraphDataProvider,
  );

  // 获取配置
  const getAutoRefreshInterval = () => {
    return vscode.workspace
      .getConfiguration("clsTelegraph")
      .get("autoRefreshInterval", 10);
  };

  const isAutoRefreshEnabled = () => {
    return vscode.workspace
      .getConfiguration("clsTelegraph")
      .get("enableAutoRefresh", false);
  };

  const isNotificationsEnabled = () => {
    return vscode.workspace
      .getConfiguration("clsTelegraph")
      .get("enableNotifications", true);
  };

  const getMaxTelegraphCount = () => {
    return vscode.workspace
      .getConfiguration("clsTelegraph")
      .get("maxTelegraphCount", 50);
  };

  // 设置自动刷新
  const setupAutoRefresh = () => {
    // 清除现有定时器
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    // 如果启用自动刷新，设置新定时器
    if (isAutoRefreshEnabled()) {
      const intervalSeconds = getAutoRefreshInterval();
      const intervalMs = intervalSeconds * 1000;

      autoRefreshTimer = setInterval(async () => {
        try {
          const newTelegraphs = await fetchTelegraphData();
          telegraphDataProvider.refresh();

          if (newTelegraphs.length > 0 && isNotificationsEnabled()) {
            // 显示新电报通知，包含具体内容
            newTelegraphs.forEach((telegraph) => {
              const preview =
                telegraph.content.length > 100
                  ? telegraph.content.substring(0, 100) + "..."
                  : telegraph.content;

              vscode.window
                .showInformationMessage(`新电报: ${preview}`, "查看详情")
                .then((selection) => {
                  if (selection === "查看详情") {
                    // 显示这条电报的详情
                    const index = telegraphData.findIndex(
                      (item) => item.id === telegraph.id,
                    );
                    if (index !== -1) {
                      vscode.commands.executeCommand(
                        "cls-telegraph.viewTelegraph",
                        index,
                      );
                    }
                  }
                });
            });
          }
        } catch (error) {
          vscode.window.showErrorMessage(`自动刷新失败: ${error.message}`);
        }
      }, intervalMs);
    }
  };

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("clsTelegraph")) {
        setupAutoRefresh();
        const status = isAutoRefreshEnabled() ? "已启用" : "已禁用";
        const interval = getAutoRefreshInterval();
        vscode.window.showInformationMessage(
          `自动刷新${status}，间隔${interval}秒`,
        );
      }
    }),
  );

  // 监听文档关闭事件
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      // 如果是我们打开的文档，从集合中移除
      if (openedDocumentUris.has(doc.uri.toString())) {
        openedDocumentUris.delete(doc.uri.toString());
      }
    }),
  );

  // 获取电报命令
  let fetchCommand = vscode.commands.registerCommand(
    "cls-telegraph.fetchTelegraph",
    async function () {
      // 显示加载中提示
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在获取财联社电报...",
          cancellable: false,
        },
        async () => {
          try {
            const newTelegraphs = await fetchTelegraphData();
            telegraphDataProvider.refresh();

            if (newTelegraphs.length > 0 && isNotificationsEnabled()) {
              // 显示新电报通知，包含具体内容
              newTelegraphs.forEach((telegraph) => {
                const preview =
                  telegraph.content.length > 100
                    ? telegraph.content.substring(0, 100) + "..."
                    : telegraph.content;

                vscode.window
                  .showInformationMessage(`新电报: ${preview}`, "查看详情")
                  .then((selection) => {
                    if (selection === "查看详情") {
                      // 显示这条电报的详情
                      const index = telegraphData.findIndex(
                        (item) => item.id === telegraph.id,
                      );
                      if (index !== -1) {
                        vscode.commands.executeCommand(
                          "cls-telegraph.viewTelegraph",
                          index,
                        );
                      }
                    }
                  });
              });
            } else {
              vscode.window.showInformationMessage("财联社电报已更新");
            }
          } catch (error) {
            vscode.window.showErrorMessage(`获取电报失败: ${error.message}`);
          }
        },
      );
    },
  );

  // 查看全部电报命令
  let viewAllTelegraphsCommand = vscode.commands.registerCommand(
    "cls-telegraph.viewAllTelegraphs",
    async function () {
      if (telegraphData.length === 0) {
        vscode.window.showInformationMessage("暂无电报数据，请先获取电报");
        return;
      }

      // 创建一个虚拟URI，避免保存提示
      const uri = vscode.Uri.parse(`untitled:cls-telegraph-all.md`);

      // 记录这个URI
      openedDocumentUris.add(uri.toString());

      // 打开文档
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);

      // 准备全部电报内容
      let content = "# 财联社电报全部内容\n\n";
      content += `更新时间: ${new Date().toLocaleString()}\n\n`;
      content += "---\n\n";

      telegraphData.forEach((item, index) => {
        content += `## 电报 ${index + 1}\n\n`;
        content += `${item.content}\n\n`;
        content += "---\n\n";
      });

      // 设置文档内容
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), content);
      await vscode.workspace.applyEdit(edit);
    },
  );

  // 查看电报详情命令
  let viewTelegraphCommand = vscode.commands.registerCommand(
    "cls-telegraph.viewTelegraph",
    async function (index) {
      if (index >= 0 && index < telegraphData.length) {
        const item = telegraphData[index];

        // 创建一个虚拟URI，避免保存提示
        const uri = vscode.Uri.parse(`untitled:cls-telegraph-${item.id}.md`);

        // 记录这个URI
        openedDocumentUris.add(uri.toString());

        // 打开文档
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);

        // 设置文档内容
        const edit = new vscode.WorkspaceEdit();
        edit.insert(
          uri,
          new vscode.Position(0, 0),
          `# 财联社电报详情\n\n${item.content}`,
        );
        await vscode.workspace.applyEdit(edit);

        // 标记为已读
        if (item.isNew) {
          item.isNew = false;
          telegraphDataProvider.refresh();
        }
      }
    },
  );

  // 清除通知命令
  let clearNotificationsCommand = vscode.commands.registerCommand(
    "cls-telegraph.clearNotifications",
    function () {
      telegraphData.forEach((item) => {
        item.isNew = false;
      });
      telegraphDataProvider.refresh();
      vscode.window.showInformationMessage("已清除所有新电报标记");
    },
  );

  context.subscriptions.push(fetchCommand);
  context.subscriptions.push(viewAllTelegraphsCommand);
  context.subscriptions.push(viewTelegraphCommand);
  context.subscriptions.push(clearNotificationsCommand);

  // 初始获取电报数据
  fetchTelegraphData().then(() => {
    telegraphDataProvider.refresh();
    // 初始设置自动刷新
    setupAutoRefresh();
  });
}

async function fetchTelegraphData() {
  try {
    // 发送HTTP请求获取网页内容
    const response = await axios.get("https://www.cls.cn/telegraph", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const html = response.data;

    // 使用cheerio加载HTML内容
    const $ = cheerio.load(html);

    // 提取带有telegraph-content-box类名的DOM元素
    const newTelegraphContents = [];
    $(".telegraph-content-box").each((index, element) => {
      newTelegraphContents.push($(element).text().trim());
    });

    // 生成电报ID（使用内容的哈希值）
    const generateId = (content) => {
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // 转换为32位整数
      }
      return hash.toString();
    };

    // 检测新电报
    const newTelegraphs = [];
    const maxCount = vscode.workspace
      .getConfiguration("clsTelegraph")
      .get("maxTelegraphCount", 50);

    // 限制电报数量
    if (newTelegraphContents.length > maxCount) {
      newTelegraphContents.length = maxCount;
    }

    // 创建新的电报数据数组
    const updatedTelegraphData = [];

    // 检查每条电报是否为新电报
    for (const content of newTelegraphContents) {
      const id = generateId(content);

      // 检查是否已存在
      const existingIndex = telegraphData.findIndex((item) => item.id === id);

      if (existingIndex !== -1) {
        // 已存在的电报，保留其isNew状态
        updatedTelegraphData.push({
          id,
          content,
          isNew: telegraphData[existingIndex].isNew,
        });
      } else {
        // 新电报
        updatedTelegraphData.push({
          id,
          content,
          isNew: true,
        });
        newTelegraphs.push({
          id,
          content,
          isNew: true,
        });
      }
    }

    // 更新电报数据
    telegraphData = updatedTelegraphData;

    return newTelegraphs;
  } catch (error) {
    console.error("抓取数据时出错:", error.message);
    throw error;
  }
}

function deactivate() {
  // 清理定时器
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

module.exports = {
  activate,
  deactivate,
};

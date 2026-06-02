const vscode = require("vscode");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

// 保存电报数据
let telegraphData = [];
// 自动刷新定时器
let autoRefreshTimer = null;

/**
 * 生成内容的哈希ID（djb2算法）
 * @param {string} content
 * @returns {string}
 */
function generateId(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString();
}

/**
 * 截取预览文本
 * @param {string} content
 * @param {number} maxLength
 * @returns {string}
 */
function truncatePreview(content, maxLength = 50) {
  return content.length > maxLength ? content.substring(0, maxLength) + "..." : content;
}

/**
 * 显示新电报通知
 * @param {Array} newTelegraphs - 新电报数组
 */
function showNewTelegraphNotifications(newTelegraphs) {
  newTelegraphs.forEach((telegraph) => {
    const preview = truncatePreview(telegraph.content, 100);
    vscode.window
      .showInformationMessage(`新电报: ${preview}`, "查看详情")
      .then((selection) => {
        if (selection === "查看详情") {
          const index = telegraphData.findIndex((item) => item.id === telegraph.id);
          if (index !== -1) {
            vscode.commands.executeCommand("cls-telegraph.viewTelegraph", index);
          }
        }
      });
  });
}

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
        treeItem.description = truncatePreview(item.content);
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
 * 获取配置
 */
function getConfig() {
  return vscode.workspace.getConfiguration("clsTelegraph");
}

function sortKeysCaseInsensitive(a, b) {
  const upperA = a.toString().toUpperCase();
  const upperB = b.toString().toUpperCase();
  if (upperA > upperB) {
    return 1;
  }
  if (upperA === upperB) {
    return 0;
  }
  return -1;
}

function serializeSignParams(params) {
  return Object.keys(params)
    .sort(sortKeysCaseInsensitive)
    .map((key) => `${key}=${params[key]}`)
    .filter(Boolean)
    .join("&");
}

function signClsParams(params) {
  const serialized = serializeSignParams(params);
  const sha1 = crypto.createHash("sha1").update(serialized).digest("hex");
  return crypto.createHash("md5").update(sha1).digest("hex");
}

function buildClsRequestParams(params) {
  const requestParams = {
    ...params,
    os: "web",
    sv: "8.7.9",
    app: "CailianpressWeb",
  };

  return {
    ...requestParams,
    sign: signClsParams(requestParams),
  };
}

function updateTelegraphData(contents) {
  const newTelegraphs = [];

  const updatedTelegraphData = contents.map((content) => {
    const id = generateId(content);
    const existing = telegraphData.find((t) => t.id === id);
    const isNew = !existing;

    if (isNew) {
      newTelegraphs.push({ id, content, isNew: true });
    }

    return {
      id,
      content,
      isNew: isNew ? true : existing.isNew,
    };
  });

  telegraphData = updatedTelegraphData;
  return newTelegraphs;
}

function stripHtml(content) {
  return cheerio.load(`<div>${content || ""}</div>`)("div").text().trim();
}

function formatTelegraphContent(item) {
  const time = item.ctime
    ? new Date(item.ctime * 1000).toLocaleString("zh-CN")
    : "";
  const title = stripHtml(item.title);
  const content = stripHtml(item.content || item.brief);

  return [time, title, content].filter(Boolean).join("\n");
}

async function fetchClsTelegraphContents(maxCount) {
  const rn = Math.min(Math.max(maxCount, 20), 100);
  const params = buildClsRequestParams({
    refresh_type: 1,
    rn,
    last_time: Math.floor(Date.now() / 1000),
  });

  const response = await axios.get("https://www.cls.cn/v1/roll/get_roll_list", {
    params,
    timeout: 10000,
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.cls.cn/telegraph",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  if (response.data && Number(response.data.errno) !== 0) {
    throw new Error(response.data.msg || `CLS API errno ${response.data.errno}`);
  }

  const rollData = response.data && response.data.data && response.data.data.roll_data;
  if (!Array.isArray(rollData)) {
    throw new Error("CLS API did not return roll_data");
  }

  return rollData
    .slice(0, maxCount)
    .map(formatTelegraphContent)
    .filter(Boolean);
}

async function fetchTelegraphContentsFromHtml(maxCount) {
  const response = await axios.get("https://www.cls.cn/telegraph", {
    timeout: 10000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  const $ = cheerio.load(response.data);
  const contents = [];
  $(".telegraph-content-box").each((_, element) => {
    if (contents.length < maxCount) {
      const content = $(element).text().trim();
      if (content) {
        contents.push(content);
      }
    }
  });

  return contents;
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

  // 设置自动刷新
  const setupAutoRefresh = () => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    const config = getConfig();
    if (config.get("enableAutoRefresh", false)) {
      const intervalMs = config.get("autoRefreshInterval", 10) * 1000;

      autoRefreshTimer = setInterval(async () => {
        try {
          const newTelegraphs = await fetchTelegraphData();
          telegraphDataProvider.refresh();

          if (newTelegraphs.length > 0 && config.get("enableNotifications", true)) {
            showNewTelegraphNotifications(newTelegraphs);
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
      }
    }),
  );

  // 获取电报命令
  const fetchCommand = vscode.commands.registerCommand(
    "cls-telegraph.fetchTelegraph",
    async function () {
      const config = getConfig();
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

            if (newTelegraphs.length > 0 && config.get("enableNotifications", true)) {
              showNewTelegraphNotifications(newTelegraphs);
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
  const viewAllTelegraphsCommand = vscode.commands.registerCommand(
    "cls-telegraph.viewAllTelegraphs",
    async function () {
      if (telegraphData.length === 0) {
        vscode.window.showInformationMessage("暂无电报数据，请先获取电报");
        return;
      }

      const uri = vscode.Uri.parse("untitled:cls-telegraph-all.md");
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      const content = telegraphData
        .map((item, index) => `## 电报 ${index + 1}\n\n${item.content}\n\n---\n\n`)
        .join("");

      const edit = new vscode.WorkspaceEdit();
      edit.insert(
        uri,
        new vscode.Position(0, 0),
        `# 财联社电报全部内容\n\n更新时间: ${new Date().toLocaleString()}\n\n---\n\n${content}`,
      );
      await vscode.workspace.applyEdit(edit);
    },
  );

  // 查看电报详情命令
  const viewTelegraphCommand = vscode.commands.registerCommand(
    "cls-telegraph.viewTelegraph",
    async function (index) {
      if (index >= 0 && index < telegraphData.length) {
        const item = telegraphData[index];
        const uri = vscode.Uri.parse(`untitled:cls-telegraph-${item.id}.md`);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), `# 财联社电报详情\n\n${item.content}`);
        await vscode.workspace.applyEdit(edit);

        if (item.isNew) {
          item.isNew = false;
          telegraphDataProvider.refresh();
        }
      }
    },
  );

  // 清除通知命令
  const clearNotificationsCommand = vscode.commands.registerCommand(
    "cls-telegraph.clearNotifications",
    function () {
      telegraphData.forEach((item) => (item.isNew = false));
      telegraphDataProvider.refresh();
      vscode.window.showInformationMessage("已清除所有新电报标记");
    },
  );

  context.subscriptions.push(
    fetchCommand,
    viewAllTelegraphsCommand,
    viewTelegraphCommand,
    clearNotificationsCommand,
  );

  // 初始获取电报数据
  fetchTelegraphData()
    .then(() => {
      telegraphDataProvider.refresh();
    })
    .catch((error) => {
      vscode.window.showErrorMessage(`初始化获取电报失败: ${error.message}`);
    })
    .finally(() => {
      setupAutoRefresh();
    });
}

async function fetchTelegraphData() {
  const config = getConfig();
  const maxCount = config.get("maxTelegraphCount", 50);

  try {
    const contents = await fetchClsTelegraphContents(maxCount);
    return updateTelegraphData(contents);
  } catch (error) {
    console.error("CLS API fetch failed", error.message);

    try {
      const contents = await fetchTelegraphContentsFromHtml(maxCount);
      if (contents.length === 0) {
        throw new Error("HTML page contains no telegraph items");
      }
      return updateTelegraphData(contents);
    } catch (fallbackError) {
      console.error("HTML fallback fetch failed", fallbackError.message);
      throw new Error(
        `CLS API failed: ${error.message}; HTML fallback failed: ${fallbackError.message}`,
      );
    }
  }
}

function deactivate() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

module.exports = {
  activate,
  deactivate,
};

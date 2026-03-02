const axios = require("axios");
const cheerio = require("cheerio");

async function fetchTelegraphData() {
  try {
    // 1. 发送HTTP请求获取网页内容
    const response = await axios.get("https://www.cls.cn/telegraph", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const html = response.data;

    // 2. 使用cheerio加载HTML内容
    const $ = cheerio.load(html);
    console.log("HTML内容:", $(".telegraph-content-box"));

    // 3. 提取带有telegraph-content-box类名的DOM元素
    const telegraphContent = [];
    $(".telegraph-content-box").each((index, element) => {
      //   console.log($(element).text());
      telegraphContent.push($(element).text().trim());
    });

    console.log("抓取到的电报内容:", telegraphContent);
    return telegraphContent;
  } catch (error) {
    console.error("抓取数据时出错:", error.message);
    return [];
  }
}

// 调用函数执行抓取
fetchTelegraphData();

const hljs = require("highlight.js");
const footnote = require("markdown-it-footnote");
const markdown = require("markdown-it");
const anchor = require("markdown-it-anchor");
const { markdownItTable } = require("markdown-it-table");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("styles.css");

  const mdLib = markdown({
    html: true,
    typographer: true,
    langPrefix: "hljs language-",
    highlight: (str, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value;
        } catch (__) {}
      }

      return "";
    },
  });

  mdLib.use(footnote);
  mdLib.use(markdownItTable);
  mdLib.use(anchor);
  eleventyConfig.addFilter("markdown", (value) => mdLib.render(value));
  eleventyConfig.setLibrary("md", mdLib);

  return {};
};

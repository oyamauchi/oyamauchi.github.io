const hljs = require('highlight.js');
const footnote = require('markdown-it-footnote');

module.exports = function(eleventyConfig) {
  eleventyConfig.amendLibrary('md', mdLib => {
    mdLib.use(footnote);
    mdLib.options.typographer = true;
    mdLib.options.highlight = (str, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, {language: lang}).value;
        } catch (__) {}
      }

      return '';
    };
  });
  return {};
}

// See https://observablehq.com/framework/config for documentation.
import { buildTOC } from "./generate-toc.ts";

export default {
  // The app's title; used in the sidebar and webpage titles.
  title: "Notes",

  // The pages and sections in the sidebar. If you don’t specify this option,
  // all pages will be listed in alphabetical order. Listing pages explicitly
  // lets you organize them into sections and have unlisted pages.
  // pages: [
  //   {
  //     name: "Examples",
  //     pages: [
  //       {name: "Dashboard", path: "/example-dashboard"},
  //       {name: "Report", path: "/example-report"}
  //     ]
  //   }
  // ],
  // The pages and sections in the sidebar are automatically generated from
  // markdown files in the src directory. Each top-level folder becomes a section,
  // with all nested files flattened. Titles are extracted from the first # header.
  // To manually regenerate the TOC, run: pnpm run generate-toc
  pages: buildTOC("./src"),

  // Content to add to the head of the page, e.g. for a favicon:
  head: '<link rel="icon" href="observable.png" type="image/png" sizes="32x32">',

  // The path to the source root.
  root: "src",

  // Some additional configuration options and their defaults:
  // theme: "default", // try "light", "dark", "slate", etc.
  // header: "", // what to show in the header (HTML)
  // footer: "Built with Observable.", // what to show in the footer (HTML)
  // sidebar: true, // whether to show the sidebar
  // toc: true, // whether to show the table of contents
  // pager: true, // whether to show previous & next links in the footer
  // output: "dist", // path to the output root for build
  // search: true, // activate search
  linkify: true, // convert URLs in Markdown to links
  typographer: true, // smart quotes and other typographic improvements
  preserveExtension: true, // drop .html from URLs
  preserveIndex: true, // drop /index from URLs
};

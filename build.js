import { promises as fs } from "fs";
import path from "path";

async function copyManifest() {
  try {
    // Read the manifest file
    const manifest = JSON.parse(await fs.readFile("./src/manifest.json", "utf-8"));

    // Write it to the dist folder
    await fs.writeFile("./dist/manifest.json", JSON.stringify(manifest, null, 2));

    console.log("Manifest copied to dist folder");
  } catch (err) {
    console.error("Error copying manifest:", err);
  }
}

// Copy any other necessary files
async function copyAdditionalFiles() {
  try {
    // Create directories if they don't exist
    await fs.mkdir("./dist/chatgpt", { recursive: true });
    await fs.mkdir("./dist/popup", { recursive: true });
    await fs.mkdir("./dist/icons", { recursive: true });

    // Copy chatgpt-interactor.js if it exists
    try {
      await fs.copyFile("./src/chatgpt/chatgpt-interactor.js", "./dist/chatgpt/chatgpt-interactor.js");
      console.log("chatgpt-interactor.js copied to dist folder");
    } catch (err) {
      console.warn("Warning: chatgpt-interactor.js not found or could not be copied");
      // Create an empty file to prevent errors
      await fs.writeFile("./dist/chatgpt/chatgpt-interactor.js", "// Placeholder file");
    }

    // Copy popup files
    try {
      await fs.copyFile("./src/popup/popup.html", "./dist/popup/popup.html");
      console.log("popup.html copied to dist folder");
      await fs.copyFile("./src/popup/popup.css", "./dist/popup/popup.css");
      console.log("popup.css copied to dist folder");

      await fs.copyFile("./src/popup/popup.js", "./dist/popup/popup.js");
      console.log("popup.js copied to dist folder");
    } catch (err) {
      console.error("Error copying popup files:", err);
    }

    // Copy icons if they exist, or create placeholders
    try {
      await fs.copyFile("./src/icons/icon16.png", "./dist/icons/icon16.png");
      await fs.copyFile("./src/icons/icon48.png", "./dist/icons/icon48.png");
      await fs.copyFile("./src/icons/icon128.png", "./dist/icons/icon128.png");
      console.log("Icons copied to dist folder");
    } catch (err) {
      console.warn("Warning: Icons not found, creating placeholders");
      // Create placeholder icons (1x1 transparent PNG)
      const transparentPixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
      await fs.writeFile("./dist/icons/icon16.png", transparentPixel);
      await fs.writeFile("./dist/icons/icon48.png", transparentPixel);
      await fs.writeFile("./dist/icons/icon128.png", transparentPixel);
    }

    console.log("Additional files copied to dist folder");
  } catch (err) {
    console.error("Error copying additional files:", err);
  }
}

// Run the copy functions
async function build() {
  await copyManifest();
  await copyAdditionalFiles();
}

build();

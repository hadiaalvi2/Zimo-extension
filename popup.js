document.getElementById("shorten").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Shortening...";

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const longUrl = tab.url;

    // Use TinyURL API
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
    const shortUrl = await response.text();

    // Copy to clipboard
    await navigator.clipboard.writeText(shortUrl);

    status.textContent = "✅ Copied: " + shortUrl;
  } catch (error) {
    console.error(error);
    status.textContent = "❌ Failed to shorten URL.";
  }
});

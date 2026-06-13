const { parse } = require('node-html-parser');

/**
 * Scrape posts from a public Telegram channel's web preview.
 * Uses https://t.me/s/{channelName} — no API key needed.
 */
async function scrapeChannel(channelName) {
  const url = `https://t.me/s/${channelName}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch channel "${channelName}": ${response.status}`);
  }

  const html = await response.text();
  const root = parse(html);

  // --- Channel info ---
  const channelInfo = parseChannelInfo(root, channelName);

  // --- Posts ---
  const messageElements = root.querySelectorAll('.tgme_widget_message_wrap');
  const posts = [];

  for (const wrap of messageElements) {
    try {
      const msg = wrap.querySelector('.tgme_widget_message');
      if (!msg) continue;

      const postId = msg.getAttribute('data-post') || '';

      // Text content
      const textEl = msg.querySelector('.tgme_widget_message_text');
      const textHtml = textEl ? textEl.innerHTML.trim() : '';
      const textPlain = textEl ? textEl.textContent.trim() : '';

      // Photo
      const photoWrap = msg.querySelector('.tgme_widget_message_photo_wrap');
      let photoUrl = null;
      if (photoWrap) {
        const style = photoWrap.getAttribute('style') || '';
        const match = style.match(/url\(['"]?(.*?)['"]?\)/);
        if (match) photoUrl = match[1];
      }

      // Video thumbnail
      const videoThumb = msg.querySelector('.tgme_widget_message_video_thumb');
      let videoThumbUrl = null;
      if (videoThumb) {
        const style = videoThumb.getAttribute('style') || '';
        const match = style.match(/url\(['"]?(.*?)['"]?\)/);
        if (match) videoThumbUrl = match[1];
      }

      // Link preview
      const linkPreview = msg.querySelector('.tgme_widget_message_link_preview');
      let preview = null;
      if (linkPreview) {
        const previewTitle = linkPreview.querySelector('.link_preview_title');
        const previewDesc = linkPreview.querySelector('.link_preview_description');
        const previewSiteName = linkPreview.querySelector('.link_preview_site_name');
        const previewImage = linkPreview.querySelector('.link_preview_image');
        let previewImgUrl = null;
        if (previewImage) {
          const style = previewImage.getAttribute('style') || '';
          const match = style.match(/url\(['"]?(.*?)['"]?\)/);
          if (match) previewImgUrl = match[1];
        }
        preview = {
          title: previewTitle ? previewTitle.textContent.trim() : null,
          description: previewDesc ? previewDesc.textContent.trim() : null,
          siteName: previewSiteName ? previewSiteName.textContent.trim() : null,
          image: previewImgUrl,
          url: linkPreview.getAttribute('href') || null,
        };
      }

      // Date
      const dateEl = msg.querySelector('.tgme_widget_message_date time');
      const datetime = dateEl ? dateEl.getAttribute('datetime') : null;

      // Views
      const viewsEl = msg.querySelector('.tgme_widget_message_views');
      const views = viewsEl ? viewsEl.textContent.trim() : null;

      // Forwarded from
      const fwdEl = msg.querySelector('.tgme_widget_message_forwarded_from_name');
      const forwardedFrom = fwdEl ? fwdEl.textContent.trim() : null;

      // Author
      const authorEl = msg.querySelector('.tgme_widget_message_from_author');
      const author = authorEl ? authorEl.textContent.trim() : null;

      posts.push({
        id: postId,
        text: textPlain,
        textHtml,
        photo: photoUrl,
        videoThumb: videoThumbUrl,
        linkPreview: preview,
        date: datetime,
        views,
        forwardedFrom,
        author,
        telegramUrl: postId ? `https://t.me/${postId}` : null,
      });
    } catch (err) {
      console.error('Error parsing message:', err.message);
    }
  }

  return { channel: channelInfo, posts: posts.reverse() };
}

/**
 * Parse channel header info from the page.
 */
function parseChannelInfo(root, channelName) {
  const titleEl = root.querySelector('.tgme_channel_info_header_title');
  const descEl = root.querySelector('.tgme_channel_info_description');
  const counterEl = root.querySelector('.tgme_channel_info_counter .counter_value');
  const avatarEl = root.querySelector('.tgme_page_photo_image img');

  // Try to get avatar from channel info or page header
  let avatarUrl = null;
  if (avatarEl) {
    avatarUrl = avatarEl.getAttribute('src');
  } else {
    const headerAvatar = root.querySelector('.tgme_header_photo img');
    if (headerAvatar) avatarUrl = headerAvatar.getAttribute('src');
  }

  return {
    username: channelName,
    title: titleEl ? titleEl.textContent.trim() : channelName,
    description: descEl ? descEl.textContent.trim() : '',
    subscribers: counterEl ? counterEl.textContent.trim() : null,
    avatar: avatarUrl,
  };
}

module.exports = { scrapeChannel };

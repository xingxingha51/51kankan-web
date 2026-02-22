// Cloudflare Pages Function: UA-based routing (replaces Nginx UA detection)
export async function onRequest(context) {
  const ua = context.request.headers.get('User-Agent') || '';

  let htmlFile = '_pc.html';
  if (/(iPhone|iPad|iPod|iOS)/i.test(ua)) {
    htmlFile = '_ios.html';
  } else if (/(Android)/i.test(ua)) {
    htmlFile = '_mobile.html';
  } else if (/(Mobile)/i.test(ua)) {
    htmlFile = '_mobile.html';
  }

  // Fetch the corresponding HTML from static assets
  const url = new URL(context.request.url);
  url.pathname = '/' + htmlFile;
  const response = await context.env.ASSETS.fetch(url);

  // Return with proper headers
  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Vary': 'User-Agent',
      'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
}

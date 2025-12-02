import { route, request } from '@/routes/utils';
import path from 'node:path';
import { art } from '@/utils/render';

export default route({
    path: '/javbees/:type?/:keyword{.*}?',

    name: 'JavBee Folo Compatible Feed',
    example: '/javbees/new',
    maintainers: ['yourname'],
    categories: ['multimedia'],
    features: { nsfw: true },

    handler,
});

async function handler(ctx) {
    const type = ctx.req.param('type') || 'new';
    const keyword = ctx.req.param('keyword') || '';

    const rootUrl = 'https://javbee.vip';

    // ----------------------------
    // 1) 构建真实可用 API URL
    // ----------------------------
    let apiUrl = '';

    if (type === 'popular' && keyword) {
        apiUrl = `${rootUrl}/api/video/popular?sort_day=${keyword}&page=1`;
    } else if (type === 'tag' && keyword) {
        apiUrl = `${rootUrl}/api/video/tag/${keyword}?page=1`;
    } else if (type === 'date' && keyword) {
        apiUrl = `${rootUrl}/api/video/date/${keyword}?page=1`;
    } else {
        apiUrl = `${rootUrl}/api/video/${type}?page=1`;
    }

    // ----------------------------
    // 2) 请求 API
    // ----------------------------
    const response = await request.get(apiUrl);
    const list = response.data?.data || [];

    const items = list.map((video) => {
        const rawTitle = video.title || 'Untitled';

        // 提取番号作为 guid
        const idMatch = rawTitle.match(/[A-Z]{2,6}-\d{2,5}/i);
        const videoId = idMatch ? idMatch[0] : 'UnknownID';

        // 封面图
        const coverImage = video.cover?.startsWith('http')
            ? video.cover
            : `https://javbee.image-sky.com${video.cover || ''}`;

        // 拼接截图（保持直链恢复逻辑）
        const screenshots = (video.screenshots || []).map((img, index) => {
            let directUrl = img.startsWith('http')
                ? img
                : `https://javbee.image-sky.com${img}`;
            return {
                directUrl,
                alt: `截图${index + 1}`,
            };
        });

        // 文件大小（用于 enclosure.length）
        const sizeMB = parseFloat(video.size_mb || '500');
        const enclosureLength = Math.max(1024 * 1024 * sizeMB, 1024 * 100);

        // 发布日期
        const pubDate = new Date(video.released_at || video.created_at).toUTCString();

        // 下载链接
        const magnetRaw = video.magnet || '';
        const torrentLinkRaw = video.torrent_url || '';

        // 标签
        const tags = video.tags || [];

        // 使用独立模板渲染 description
        const description = art(path.join(__dirname, 'templates/description.art'), {
            coverImage,
            id: videoId,
            size: video.size || '',
            pubDate: pubDate.replace(' GMT', ''),
            screenshots,
            magnetRaw,
            torrentLinkRaw,
            tags,
        });

        return {
            title: rawTitle,
            description,
            link: `${rootUrl}/detail/${video.slug}`,
            guid: videoId,
            pubDate,
            author: 'JavBee',

            enclosure_url: torrentLinkRaw || '', // Folo 强依赖
            enclosure_type: 'application/x-bittorrent',
            enclosure_length: enclosureLength,
            category: tags,
        };
    });

    return {
        title: `JavBee - ${type.toUpperCase()} (Folo)`,
        link: `${rootUrl}/${type}`,
        description: 'JavBee Folo Compatible Feed',
        item: items,
        language: 'en',
        lastBuildDate: new Date().toUTCString(),
        ttl: 5,
    };
}

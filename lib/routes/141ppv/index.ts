import { Route } from '@/types';
import { getSubPath } from '@/utils/common-utils';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

export const route: Route = {
    path: '/:type/:keyword{.*}?',
    categories: ['multimedia'],
    name: '通用',
    maintainers: ['cgkings', 'nczitzk'],
    parameters: { type: '类型，可查看下表的类型说明', keyword: '关键词，可查看下表的关键词说明' },
    handler,
    description: `**类型**

| 最新 | 热门    | 随机   | 指定演员 | 指定标签 | 日期 |
| ---- | ------- | ------ | -------- | -------- | ---- |
| new  | popular | random | actress  | tag      | date |

**关键词**

| 空 | 日期范围    | 演员名       | 标签名         | 年月日     |
| -- | ----------- | ------------ | -------------- | ---------- |
|    | 7 / 30 / 60 | Yua%20Mikami | Adult%20Awards | 2020/07/30 |

**示例说明**

-  \`/141ppv/new\`

      仅当类型为 \`new\` \`popular\` 或 \`random\` 时关键词为 **空**

-  \`/141ppv/popular/30\`

      \`popular\` \`random\` 类型的关键词可填写 \`7\` \`30\` 或 \`60\` 三个 **日期范围** 之一，分别对应 **7 天**、**30 天** 或 **60 天内**

-  \`/141ppv/actress/Yua%20Mikami\`

      \`actress\` 类型的关键词必须填写 **演员名** ，可在 [此处](https://141ppv.com/actress/) 演员单页链接中获取

-  \`/141ppv/tag/Adult%20Awards\`

      \`tag\` 类型的关键词必须填写 **标签名** 且标签中的 \`/\` 必须替换为 \`%2F\` ，可在 [此处](https://141ppv.com/tag/) 标签单页链接中获取

-  \`/141ppv/date/2020/07/30\`

      \`date\` 类型的关键词必须填写 **日期(年/月/日)**`,
    features: {
        nsfw: true,
    },
};

async function handler(ctx) {
    const rootUrl = 'https://www.141ppv.com';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    const currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;

    const response = await got({
        method: 'get',
        url: currentUrl,
    });

    const $ = load(response.data);

    if (getSubPath(ctx) === '/') {
        ctx.set('redirect', `/141ppv${$('.overview').first().attr('href')}`);
        return;
    }

    const items = $('.columns')
        .toArray()
        .map((item) => {
            item = $(item);

            const id = item.find('.title a').text();
            const size = item.find('.title span').text();
            const pubDate = item.find('.subtitle a').attr('href').split('/date/').pop();
            const description = item.find('.has-text-grey-dark').text();
            const actresses = item
                .find('.panel-block')
                .toArray()
                .map((a) => $(a).text().trim());
            const tags = item
                .find('.tag')
                .toArray()
                .map((t) => $(t).text().trim());
            const magnet = item.find('a[title="Magnet torrent"]').attr('href');
            const torrentLink = item.find('a[title="Download .torrent"]').attr('href'); // 重命名区分torrent链接
            const onErrorAttr = item.find('.image').attr('onerror');
            const backupImageRegex = /this\.src='(.*?)'/;
            const match = backupImageRegex.exec(onErrorAttr);
            const image = match ? match[1] : item.find('.image').attr('src');
            const detailLink = new URL(item.find('a').first().attr('href'), rootUrl).href; // 详情页链接

            // ========== 核心修正：磁力链接转义 + 规范Enclosure配置 ==========
            // XML转义：& → &amp;，避免解析错误
            const escapedMagnet = magnet ? magnet.replace(/&/g, '&amp;') : '';
            const escapedTorrentLink = torrentLink ? torrentLink.replace(/&/g, '&amp;') : '';

            // 构造多Enclosure（磁力+Torrent，适配Folo）
            const enclosures = [];
            if (escapedMagnet) {
                enclosures.push({
                    url: escapedMagnet,
                    type: 'x-scheme-handler/magnet', // 磁力链接正确Type
                });
            }
            if (escapedTorrentLink) {
                enclosures.push({
                    url: escapedTorrentLink,
                    type: 'application/x-bittorrent', // Torrent文件正确Type
                });
            }

            return {
                title: `${id} ${size}`,
                pubDate: parseDate(pubDate, 'YYYY/MM/DD'),
                link: detailLink, // 详情页链接（符合RSS规范）
                description: art(path.join(__dirname, 'templates/description.art'), {
                    image,
                    id,
                    size,
                    pubDate,
                    description,
                    actresses,
                    tags,
                    magnet, // 原链接（description中无需转义）
                    torrentLink, // 传给模板的torrent链接
                }),
                author: actresses.join(', '),
                category: [...tags, ...actresses],
                enclosure: enclosures.length > 0 ? enclosures : undefined, // 多Enclosure配置
            };
        });

    return {
        title: `141PPV - ${$('title').text().split('-')[0].trim()}`,
        link: currentUrl,
        item: items,
    };
}
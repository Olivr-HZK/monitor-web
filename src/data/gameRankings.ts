import type { GameRanking } from '../types';

export const mockGameRankings: GameRanking[] = [
  {
    type: '微信小游戏',
    title: '微信小游戏周榜',
    updateTime: '2026-01-28 14:00',
    period: '周榜',
    items: [
      {
        id: 'wx1',
        rank: 1,
        name: '羊了个羊',
        developer: '简游科技',
        category: '消除',
        change: '—',
        score: 9.2,
        downloads: '5000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx2',
        rank: 2,
        name: '跳一跳',
        developer: '腾讯',
        category: '休闲',
        change: '↑1',
        score: 8.9,
        downloads: '3000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx3',
        rank: 3,
        name: '合成大西瓜',
        developer: '微伞游戏',
        category: '合成',
        change: '↓1',
        score: 8.7,
        downloads: '2000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx4',
        rank: 4,
        name: '动物餐厅',
        developer: '暖风科技',
        category: '模拟经营',
        change: '↑2',
        score: 8.5,
        downloads: '1500万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx5',
        rank: 5,
        name: '消灭病毒',
        developer: 'Ohayoo',
        category: '射击',
        change: '↓1',
        score: 8.3,
        downloads: '1200万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx6',
        rank: 6,
        name: '最强弹一弹',
        developer: '腾讯',
        category: '益智',
        change: '—',
        score: 8.1,
        downloads: '1000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx7',
        rank: 7,
        name: '欢乐斗地主',
        developer: '腾讯',
        category: '棋牌',
        change: '↑1',
        score: 7.9,
        downloads: '800万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx8',
        rank: 8,
        name: '天天酷跑',
        developer: '腾讯',
        category: '跑酷',
        change: '↓2',
        score: 7.7,
        downloads: '600万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx9',
        rank: 9,
        name: '保卫萝卜',
        developer: '飞鱼科技',
        category: '塔防',
        change: '—',
        score: 7.5,
        downloads: '500万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'wx10',
        rank: 10,
        name: '开心消消乐',
        developer: '乐元素',
        category: '消除',
        change: '↑1',
        score: 7.3,
        downloads: '400万+',
        updateDate: '2026-01-28'
      }
    ]
  },
  {
    type: '抖音小游戏',
    title: '抖音小游戏周榜',
    updateTime: '2026-01-28 14:00',
    period: '周榜',
    items: [
      {
        id: 'dy1',
        rank: 1,
        name: '我功夫特牛',
        developer: 'Ohayoo',
        category: '动作',
        change: '—',
        score: 9.0,
        downloads: '8000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy2',
        rank: 2,
        name: '脑洞大师',
        developer: 'Focus Apps',
        category: '益智',
        change: '↑1',
        score: 8.8,
        downloads: '6000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy3',
        rank: 3,
        name: '是特工就上一百层',
        developer: 'Ohayoo',
        category: '动作',
        change: '↓1',
        score: 8.6,
        downloads: '5000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy4',
        rank: 4,
        name: '我的小家',
        developer: 'Ohayoo',
        category: '消除',
        change: '↑2',
        score: 8.4,
        downloads: '4000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy5',
        rank: 5,
        name: '我飞刀玩得贼6',
        developer: 'Ohayoo',
        category: '休闲',
        change: '—',
        score: 8.2,
        downloads: '3500万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy6',
        rank: 6,
        name: '音跃球球',
        developer: '字节跳动',
        category: '音乐',
        change: '↓1',
        score: 8.0,
        downloads: '3000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy7',
        rank: 7,
        name: '全民漂移',
        developer: 'Ohayoo',
        category: '竞速',
        change: '↑1',
        score: 7.8,
        downloads: '2500万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy8',
        rank: 8,
        name: '消灭病毒',
        developer: 'Ohayoo',
        category: '射击',
        change: '↓2',
        score: 7.6,
        downloads: '2000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy9',
        rank: 9,
        name: '我眼神儿贼好',
        developer: 'Ohayoo',
        category: '找茬',
        change: '—',
        score: 7.4,
        downloads: '1800万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'dy10',
        rank: 10,
        name: '我的小家2',
        developer: 'Ohayoo',
        category: '消除',
        change: '↑1',
        score: 7.2,
        downloads: '1500万+',
        updateDate: '2026-01-28'
      }
    ]
  },
  {
    type: '安卓游戏',
    title: '安卓游戏排行榜',
    updateTime: '2026-01-28 14:00',
    period: '周榜',
    items: [
      {
        id: 'android1',
        rank: 1,
        name: '王者荣耀',
        developer: '腾讯游戏',
        category: 'MOBA',
        change: '—',
        score: 9.5,
        downloads: '10亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android2',
        rank: 2,
        name: '和平精英',
        developer: '腾讯游戏',
        category: '射击',
        change: '—',
        score: 9.3,
        downloads: '8亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android3',
        rank: 3,
        name: '原神',
        developer: '米哈游',
        category: 'RPG',
        change: '↑1',
        score: 9.1,
        downloads: '5亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android4',
        rank: 4,
        name: '英雄联盟手游',
        developer: '拳头游戏',
        category: 'MOBA',
        change: '↓1',
        score: 8.9,
        downloads: '3亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android5',
        rank: 5,
        name: '崩坏：星穹铁道',
        developer: '米哈游',
        category: 'RPG',
        change: '—',
        score: 8.7,
        downloads: '2亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android6',
        rank: 6,
        name: '金铲铲之战',
        developer: '腾讯游戏',
        category: '策略',
        change: '↑1',
        score: 8.5,
        downloads: '1.5亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android7',
        rank: 7,
        name: '蛋仔派对',
        developer: '网易游戏',
        category: '休闲',
        change: '↓1',
        score: 8.3,
        downloads: '1.2亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android8',
        rank: 8,
        name: '光遇',
        developer: 'Thatgamecompany',
        category: '冒险',
        change: '—',
        score: 8.1,
        downloads: '1亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android9',
        rank: 9,
        name: '我的世界',
        developer: 'Mojang',
        category: '沙盒',
        change: '↑1',
        score: 7.9,
        downloads: '8000万+',
        updateDate: '2026-01-28'
      },
      {
        id: 'android10',
        rank: 10,
        name: '明日方舟',
        developer: '鹰角网络',
        category: '策略',
        change: '↓1',
        score: 7.7,
        downloads: '6000万+',
        updateDate: '2026-01-28'
      }
    ]
  },
  {
    type: 'iOS游戏',
    title: 'iOS游戏排行榜',
    updateTime: '2026-01-28 14:00',
    period: '周榜',
    items: [
      {
        id: 'ios1',
        rank: 1,
        name: '王者荣耀',
        developer: '腾讯游戏',
        category: 'MOBA',
        change: '—',
        score: 9.5,
        downloads: '10亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios2',
        rank: 2,
        name: '和平精英',
        developer: '腾讯游戏',
        category: '射击',
        change: '—',
        score: 9.3,
        downloads: '8亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios3',
        rank: 3,
        name: '原神',
        developer: '米哈游',
        category: 'RPG',
        change: '↑1',
        score: 9.1,
        downloads: '5亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios4',
        rank: 4,
        name: '崩坏：星穹铁道',
        developer: '米哈游',
        category: 'RPG',
        change: '↓1',
        score: 8.9,
        downloads: '3亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios5',
        rank: 5,
        name: '英雄联盟手游',
        developer: '拳头游戏',
        category: 'MOBA',
        change: '—',
        score: 8.7,
        downloads: '2.5亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios6',
        rank: 6,
        name: '蛋仔派对',
        developer: '网易游戏',
        category: '休闲',
        change: '↑1',
        score: 8.5,
        downloads: '2亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios7',
        rank: 7,
        name: '金铲铲之战',
        developer: '腾讯游戏',
        category: '策略',
        change: '↓1',
        score: 8.3,
        downloads: '1.8亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios8',
        rank: 8,
        name: '光遇',
        developer: 'Thatgamecompany',
        category: '冒险',
        change: '—',
        score: 8.1,
        downloads: '1.5亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios9',
        rank: 9,
        name: '我的世界',
        developer: 'Mojang',
        category: '沙盒',
        change: '↑1',
        score: 7.9,
        downloads: '1.2亿+',
        updateDate: '2026-01-28'
      },
      {
        id: 'ios10',
        rank: 10,
        name: '明日方舟',
        developer: '鹰角网络',
        category: '策略',
        change: '↓1',
        score: 7.7,
        downloads: '1亿+',
        updateDate: '2026-01-28'
      }
    ]
  }
];


import type { Locale } from '@/context/LanguageContext';

const dictionaries = {
  en: {
    nav: {
      home: 'Home',
      library: 'Library',
      reader: 'Reader',
      media: 'Media',
      favorites: 'Favorites',
      notes: 'Notes',
      profile: 'Profile',
      admin: 'Admin',
      logout: 'Logout',
      login: 'Login',
    },
  },
  'zh-CN': {
    nav: {
      home: '首页',
      library: '书库',
      reader: '阅读器',
      media: '媒体',
      favorites: '收藏',
      notes: '笔记',
      profile: '个人资料',
      admin: '管理',
      logout: '登出',
      login: '登录',
    },
  },
  // Add other languages here...
};

export const getDictionary = (locale: Locale) => {
    // Fallback to English if the dictionary for the locale doesn't exist
    return dictionaries[locale] || dictionaries.en;
};

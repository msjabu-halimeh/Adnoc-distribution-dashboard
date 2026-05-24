import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        adnoc: {
          navy: '#0B1F3A',
          teal: '#1D9BC8',
          mint: '#6AD6C5',
          amber: '#F4C95D',
          sand: '#F7F3E8',
          steel: '#DCE4EC',
        },
      },
      boxShadow: {
        glow: '0 25px 70px rgba(11, 31, 58, 0.16)',
      },
    },
  },
  plugins: [],
};

export default config;
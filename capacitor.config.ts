import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {appId:'app.questbook.mobile',appName:'neustroy',webDir:'dist/client',plugins:{LocalNotifications:{smallIcon:'ic_stat_questbook',iconColor:'#3567ff'},PushNotifications:{presentationOptions:['badge','sound','alert']}}};
export default config;

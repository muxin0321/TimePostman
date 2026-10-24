import { curves } from '@kit.ArkUI';
import { PcDevice, PC_PORT } from '../model/Types';

@Component
export struct ConnectionCard {
  @Prop paired: boolean = false;
  @Prop pcHost: string = '';
  @Prop pcPort: number = PC_PORT;
  @Prop isUsb: boolean = false;
  @Prop discovering: boolean = false;
  @Prop pairBusy: boolean = false;
  @Prop pendingPair: boolean = false;
  @Prop expanded: boolean = false;
  @Prop discovered: PcDevice[] = [];
  @Link manualHost: string;
  @Link pairCode: string;
  onDiscover: () => void = () => {};
  onPair: (host: string, port: number) => void = () => {};
  onConfirm: () => void = () => {};
  onCancel: () => void = () => {};
  onReset: () => void = () => {};
  onToggleUsb: () => void = () => {};
  onToggleExpanded: () => void = () => {};

  build() {
    if (!this.paired) {
      Column({ space: 12 }) {
        Text('连接电脑')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
        Text('电脑和手机在同一局域网，打开电脑端程序后点“发现电脑”。USB 连接可手动输入 127.0.0.1。')
          .fontSize(12)
          .fontColor($r('app.color.text_muted'))
        Button(this.discovering ? '搜索中…' : '发现电脑')
          .onClick(() => {
            this.onDiscover();
          })
          .enabled(!this.discovering)
          .width('100%')
        if (this.discovered.length > 0) {
          Column({ space: 8 }) {
            ForEach(this.discovered, (device: PcDevice) => {
              Row({ space: 10 }) {
                Column({ space: 2 }) {
                  Text(device.name)
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'))
                  Text(`${device.host}:${device.port}`)
                    .fontSize(11)
                    .fontColor($r('app.color.text_faint'))
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
                Button('配对')
                  .onClick(() => {
                    this.onPair(device.host, device.port);
                  })
                  .enabled(!this.pairBusy)
              }
              .width('100%')
              .padding(10)
              .backgroundColor($r('app.color.surface'))
              .borderRadius(10)
            }, (device: PcDevice) => `${device.host}:${device.port}`)
          }
          .width('100%')
        }
        Row({ space: 8 }) {
          TextInput({ text: this.manualHost, placeholder: '手动输入电脑 IP' })
            .onChange((value: string) => {
              this.manualHost = value;
            })
            .layoutWeight(1)
          Button('用 IP 配对')
            .onClick(() => {
              this.onPair(this.manualHost, PC_PORT);
            })
            .enabled(!this.pairBusy)
        }
        .width('100%')
        if (this.pendingPair) {
          Column({ space: 8 }) {
            Text('电脑页面显示的 6 位配对码')
              .fontSize(13)
              .fontColor($r('app.color.text_secondary'))
            TextInput({ text: this.pairCode, placeholder: '6 位数字' })
              .type(InputType.Number)
              .maxLength(6)
              .onChange((value: string) => {
                this.pairCode = value;
              })
              .width('100%')
            Row({ space: 8 }) {
              Button(this.pairBusy ? '确认中…' : '确认配对')
                .onClick(() => {
                  this.onConfirm();
                })
                .enabled(!this.pairBusy)
                .layoutWeight(1)
              Button('取消')
                .onClick(() => {
                  this.onCancel();
                })
                .enabled(!this.pairBusy)
            }
            .width('100%')
          }
          .width('100%')
          .padding(12)
          .backgroundColor($r('app.color.surface_soft'))
          .borderRadius(10)
        }
      }
      .width('100%')
      .padding(16)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(14)
      .alignItems(HorizontalAlign.Start)
    } else {
      Column({ space: 8 }) {
        Row({ space: 8 }) {
          Column({ space: 2 }) {
            Text('已连接电脑')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.success'))
            Text(`${this.pcHost}:${this.pcPort}`)
              .fontSize(11)
              .fontColor($r('app.color.text_muted'))
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Text(this.isUsb ? 'USB' : 'Wi-Fi')
            .fontSize(10)
            .fontColor(this.isUsb ? $r('app.color.success') : $r('app.color.accent'))
            .backgroundColor(this.isUsb ? $r('app.color.success_soft') : $r('app.color.accent_soft'))
            .padding({ left: 8, right: 8, top: 3, bottom: 3 })
            .borderRadius(10)
          Button(this.expanded ? '收起' : '设置')
            .fontSize(12)
            .height(36)
            .onClick(() => {
              this.onToggleExpanded();
            })
        }
        .width('100%')
        if (this.expanded) {
          Row({ space: 8 }) {
            Button(this.isUsb ? '切回 Wi-Fi' : 'USB 直连')
              .fontSize(12)
              .onClick(() => {
                this.onToggleUsb();
              })
              .enabled(!this.discovering && !this.pairBusy)
              .layoutWeight(1)
            Button('重新配对')
              .fontSize(12)
              .onClick(() => {
                this.onReset();
              })
              .enabled(!this.discovering && !this.pairBusy)
              .layoutWeight(1)
          }
          .width('100%')
          .transition(TransitionEffect.OPACITY.animation({ duration: 300, curve: curves.springMotion(0.3, 0.76) }))
        }
      }
      .width('100%')
      .padding(12)
      .backgroundColor($r('app.color.success_soft'))
      .borderRadius(12)
    }
  }
}

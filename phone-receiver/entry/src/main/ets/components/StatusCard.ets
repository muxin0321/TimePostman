import { curves } from '@kit.ArkUI';

@Component
export struct StatusCard {
  @Prop status: string = '';
  @Prop busy: boolean = false;
  @Prop uploading: boolean = false;
  @Prop uploadProgress: number = 0;
  @Prop uploadStage: string = '';
  @Prop downloading: boolean = false;
  @Prop downloadProgress: number = 0;
  @Prop downloadStage: string = '';
  @Prop speedText: string = '';

  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        if (this.busy) {
          LoadingProgress()
            .width(18)
            .height(18)
            .color($r('app.color.accent'))
            .animation({ duration: 280, curve: curves.springMotion(0.28, 0.78) })
        }
        Text(this.status)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.uploading) {
        Column({ space: 4 }) {
          Progress({ value: this.uploadProgress, total: 100, type: ProgressType.Linear })
            .width('100%')
            .color($r('app.color.accent'))
            .animation({ duration: 280, curve: curves.springMotion(0.28, 0.78) })
          Row() {
            Text(this.uploadStage)
              .fontSize(11)
              .fontColor($r('app.color.text_muted'))
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(`${this.uploadProgress}%${this.speedText ? ' · ' + this.speedText : ''}`)
              .fontSize(11)
              .fontColor($r('app.color.text_muted'))
          }
          .width('100%')
        }
        .width('100%')
      }

      if (this.downloading) {
        Column({ space: 4 }) {
          Progress({ value: this.downloadProgress, total: 100, type: ProgressType.Linear })
            .width('100%')
            .color($r('app.color.success'))
            .animation({ duration: 280, curve: curves.springMotion(0.28, 0.78) })
          Row() {
            Text(this.downloadStage)
              .fontSize(11)
              .fontColor($r('app.color.text_muted'))
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(`${this.downloadProgress}%${this.speedText ? ' · ' + this.speedText : ''}`)
              .fontSize(11)
              .fontColor($r('app.color.text_muted'))
          }
          .width('100%')
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(14)
    .border({ width: 1, color: $r('app.color.border') })
    .shadow({ radius: 18, color: $r('app.color.shadow'), offsetY: 5 })
    .alignItems(HorizontalAlign.Start)
  }
}

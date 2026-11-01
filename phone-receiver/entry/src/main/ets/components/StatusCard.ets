import { curves } from '@kit.ArkUI';

interface StatusLine {
  id: number;
  text: string;
}

@Component
export struct StatusCard {
  @Prop @Watch('onStatusChanged') status: string = '';
  @Prop busy: boolean = false;
  @Prop uploading: boolean = false;
  @Prop uploadProgress: number = 0;
  @Prop uploadStage: string = '';
  @Prop downloading: boolean = false;
  @Prop downloadProgress: number = 0;
  @Prop downloadStage: string = '';
  @Prop speedText: string = '';
  @State lines: StatusLine[] = [];
  private lineSeq: number = 0;
  private lastStatus: string = '';

  aboutToAppear(): void {
    this.lastStatus = this.status;
    this.lines = [{ id: this.lineSeq++, text: this.status }];
  }

  private onStatusChanged(): void {
    if (this.status === this.lastStatus) return;
    this.lastStatus = this.status;
    const next: StatusLine = { id: this.lineSeq++, text: this.status };
    animateTo({
      duration: 340,
      curve: curves.springMotion(0.34, 0.86)
    }, () => {
      this.lines = [next];
    });
  }

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
        Stack({ alignContent: Alignment.TopStart }) {
          ForEach(this.lines, (line: StatusLine) => {
            Text(line.text)
              .width('100%')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.text_primary'))
              .transition(TransitionEffect.asymmetric(
                TransitionEffect.OPACITY
                  .combine(TransitionEffect.translate({ y: 16 }))
                  .animation({ duration: 340, curve: curves.springMotion(0.34, 0.86) }),
                TransitionEffect.OPACITY
                  .combine(TransitionEffect.translate({ y: -16 }))
                  .animation({ duration: 240, curve: curves.springMotion(0.4, 0.9) })
              ))
          }, (line: StatusLine) => line.id.toString())
        }
        .layoutWeight(1)
        .clip(true)
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
    .borderRadius(24)
    .border({ width: 1, color: $r('app.color.border') })
    .shadow({ radius: 18, color: $r('app.color.shadow'), offsetY: 5 })
    .alignItems(HorizontalAlign.Start)
  }
}

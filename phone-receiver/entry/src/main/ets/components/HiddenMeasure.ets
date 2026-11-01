@Component
export struct HiddenMeasure {
  @BuilderParam content: () => void = this.emptyContent;
  onHeight: (height: number) => void = () => {};
  private reportedHeight: number = -1;

  @Builder
  emptyContent() {
  }

  onMeasureSize(selfLayoutInfo: GeometryInfo, children: Measurable[], constraint: ConstraintSizeOptions): SizeResult {
    const rawWidth = Number(constraint.maxWidth);
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 360;
    let naturalHeight = 0;
    for (let index = 0; index < children.length; index++) {
      const measured = children[index].measure({
        minWidth: width,
        maxWidth: width,
        minHeight: 0,
        maxHeight: 100000
      });
      naturalHeight = Math.max(naturalHeight, measured.height);
    }
    if (naturalHeight > 0 && Math.abs(naturalHeight - this.reportedHeight) > 0.5) {
      this.reportedHeight = naturalHeight;
      const reported = naturalHeight;
      setTimeout(() => {
        this.onHeight(reported);
      }, 0);
    }
    return { width: width, height: 0 };
  }

  onPlaceChildren(selfLayoutInfo: GeometryInfo, children: Layoutable[], constraint: ConstraintSizeOptions): void {
    for (let index = 0; index < children.length; index++) {
      children[index].layout({ x: 0, y: 0 });
    }
  }

  build() {
    Column() {
      this.content()
    }
    .width('100%')
    .opacity(0)
    .hitTestBehavior(HitTestMode.None)
    .accessibilityLevel('no-hide-descendants')
  }
}

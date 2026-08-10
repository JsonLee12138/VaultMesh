import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2Icon, ChevronRightIcon, CircleIcon, SaveIcon, type LucideIcon } from 'lucide-react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';

export interface SectionedEditorSection {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  complete: boolean;
  content: ReactNode;
}

interface SectionedEditorFormProps {
  formId: string;
  sections: SectionedEditorSection[];
  error: string | null;
  busy: boolean;
  submitLabel: string;
  savingLabel?: string;
  submitDisabled?: boolean;
  submitActions?: ReactNode;
  onCancel(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function SectionedEditorForm({
  formId,
  sections,
  error,
  busy,
  submitLabel,
  savingLabel = '正在保存…',
  submitDisabled = false,
  submitActions,
  onCancel,
  onSubmit,
}: SectionedEditorFormProps) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? '');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionNavigationTimerRef = useRef<number | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSection)) setActiveSection(sections[0]?.id ?? '');
  }, [activeSection, sections]);

  const goToSection = (sectionId: string): void => {
    setActiveSection(sectionId);
    if (sectionNavigationTimerRef.current !== null) window.clearTimeout(sectionNavigationTimerRef.current);
    sectionNavigationTimerRef.current = window.setTimeout(() => {
      sectionNavigationTimerRef.current = null;
    }, 1_200);

    const section = sectionRefs.current[sectionId];
    const content = contentRef.current;
    if (section && content) {
      const paddingTop = Number.parseFloat(window.getComputedStyle(content).paddingTop) || 0;
      const top = content.scrollTop + section.getBoundingClientRect().top - content.getBoundingClientRect().top - paddingTop;
      content.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const handleScroll = (): void => {
    const content = contentRef.current;
    if (!content || sectionNavigationTimerRef.current !== null || sections.length === 0) return;
    const contentTop = content.getBoundingClientRect().top;
    let nextSection = sections[0]!.id;
    for (const section of sections) {
      const element = sectionRefs.current[section.id];
      if (element && element.getBoundingClientRect().top <= contentTop + 48) nextSection = section.id;
    }
    if (nextSection !== activeSection) setActiveSection(nextSection);
  };

  const activeSectionIndex = sections.findIndex((section) => section.id === activeSection);
  const nextSection = sections[activeSectionIndex + 1] ?? null;

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <form id={formId} className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={onSubmit}>
        {error && <div className="px-5 pt-4"><ErrorBanner message={error} /></div>}
        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="表单分区" className="flex gap-2 overflow-x-auto border-b p-3 lg:flex-col lg:border-r lg:border-b-0 lg:p-4" data-editor-navigation>
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <Button
                  className="h-auto min-w-40 justify-start py-3 lg:min-w-0"
                  key={section.id}
                  variant={activeSection === section.id ? 'secondary' : 'ghost'}
                  type="button"
                  aria-current={activeSection === section.id ? 'step' : undefined}
                  onClick={() => goToSection(section.id)}
                >
                  <Icon data-icon="inline-start" />
                  <span className="truncate">{section.label}</span>
                  {section.complete ? <CheckCircle2Icon className="ml-auto" aria-label="已填写" /> : <CircleIcon className="ml-auto" aria-label="未填写" />}
                </Button>
              );
            })}
          </nav>

          <div
            ref={contentRef}
            className="min-h-0 min-w-0 scroll-smooth overflow-y-auto px-5 py-7 lg:px-12 lg:py-10"
            data-editor-scroll-region
            onScroll={handleScroll}
          >
            {sections.map((section, index) => {
              const titleId = `${formId}-${section.id}-title`;
              return (
                <div key={section.id}>
                  {index > 0 && <Separator className="my-8" />}
                  <section
                    ref={(element) => { sectionRefs.current[section.id] = element; }}
                    className="scroll-mt-6 outline-none"
                    tabIndex={-1}
                    aria-labelledby={titleId}
                  >
                    <div className="mb-6">
                      <h2 id={titleId} className="text-xl font-semibold">{section.label}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                    </div>
                    {section.content}
                  </section>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-4 lg:px-8">
          <Button variant="outline" type="button" onClick={onCancel}>取消</Button>
          <div className="flex gap-2">
            {nextSection && (
              <Button variant="outline" type="button" onClick={() => goToSection(nextSection.id)}>
                下一步：{nextSection.label}
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            )}
            {submitActions}
            <Button type="submit" disabled={busy || submitDisabled}>
              {busy ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
              {busy ? savingLabel : submitLabel}
            </Button>
          </div>
        </footer>
      </form>
    </section>
  );
}

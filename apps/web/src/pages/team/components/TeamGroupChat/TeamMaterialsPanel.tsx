// @ts-nocheck
import { Button } from '@arco-design/web-react';
import { FileText, UploadOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  files: string[];
  uploading: boolean;
  onUpload: () => void;
  onOpen: (file_path: string) => void;
};

const fileNameOf = (file_path: string) => file_path.split(/[/\\]/).pop() || file_path;

const TeamMaterialsPanel: React.FC<Props> = ({ files, uploading, onUpload, onOpen }) => {
  const { t } = useTranslation();

  return (
    <section
      className='shrink-0 border-b border-solid border-[color:var(--border-base)] bg-2 px-20px py-10px'
      data-testid='team-group-materials'
    >
      <div className='mx-auto flex w-full max-w-860px items-center gap-12px'>
        <div className='flex min-w-0 flex-1 items-center gap-8px'>
          <FileText theme='outline' size='17' fill='currentColor' className='shrink-0 text-t-secondary' />
          <span className='shrink-0 text-13px font-600 text-t-primary'>{t('team.groupChat.materialsTitle')}</span>
          {files.length === 0 ? (
            <span className='truncate text-12px text-t-tertiary'>{t('team.groupChat.materialsEmpty')}</span>
          ) : (
            <div className='flex min-w-0 items-center gap-5px overflow-x-auto [scrollbar-width:none]'>
              {files.map((file_path) => (
                <Button
                  key={file_path}
                  type='secondary'
                  size='mini'
                  icon={<FileText theme='outline' size='13' fill='currentColor' />}
                  title={t('team.groupChat.openMaterial')}
                  onClick={() => onOpen(file_path)}
                  className='!max-w-180px !shrink-0'
                >
                  <span className='truncate'>{fileNameOf(file_path)}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
        <Button
          type='outline'
          size='small'
          loading={uploading}
          icon={<UploadOne theme='outline' size='15' fill='currentColor' />}
          onClick={onUpload}
          data-testid='team-group-upload-material'
        >
          {t('team.groupChat.uploadMaterial')}
        </Button>
      </div>
    </section>
  );
};

export default TeamMaterialsPanel;

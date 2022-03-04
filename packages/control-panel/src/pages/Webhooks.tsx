import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Avatar, Button, Flex, Heading, HStack, Stack, Text,
} from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import RouteParams from '@/types/RouteParams';
import { useDiscordWebhooks } from '@/features/discordWebhooks';
import { DashboardContent } from '@/components';
import { useDiscordServer } from '@/features/discordServers';

interface Props {

}

const Webhooks: React.FC<Props> = () => {
  const { t } = useTranslation();
  const { serverId } = useParams<RouteParams>();
  const { data: serverData } = useDiscordServer({
    serverId,
  });
  const { data, status, error } = useDiscordWebhooks({
    serverId,
    isWebhooksEnabled: serverData?.isWebhooksEnabled,
  });

  console.log(serverData);

  if (!serverData?.isWebhooksEnabled) {
    return (
      <DashboardContent>
        <Alert
          status="warning"
          variant="subtle"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          textAlign="center"
          height="200px"
        >
          <AlertIcon boxSize="40px" mr={0} />
          <AlertTitle mt={4} mb={1} fontSize="lg">
            This server does not have webhooks enabled
          </AlertTitle>
          <AlertDescription maxWidth="sm">
            You will have to be a supporter to access this feature.
          </AlertDescription>
        </Alert>

      </DashboardContent>
    );
  }

  return (
    <DashboardContent
      loading={status === 'loading' || status === 'idle'}
      error={error}
    >
      <Stack spacing="8">
        <Flex justifyContent="space-between">
          <Heading size="lg">{t('pages.webhooks.title')}</Heading>
          <Button colorScheme="blue">{t('pages.webhooks.addNew')}</Button>
        </Flex>
        <Stack spacing="4">
          {data?.map((webhook) => (
            <HStack
              background="gray.700"
              borderRadius="lg"
              padding="4"
              justifyContent="space-between"
            >
              <HStack
                overflow="hidden"
                marginRight="10"
                spacing="4"
              >
                <Avatar
                  name={webhook.name}
                  src={webhook.avatarUrl}
                />
                <Text
                  textOverflow="ellipsis"
                  overflow="hidden"
                  display="block"
                >
                  {webhook.name}

                </Text>
              </HStack>
            </HStack>
          ))}
        </Stack>
      </Stack>
    </DashboardContent>
  );
};

export default Webhooks;
